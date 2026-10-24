// Which phone alerts to send at one check. A pure function: no network, no
// files, no clock, so every rule can be unit-tested. Times are UTC inside;
// the alert text shows the computer's local time (or the timeZone given).
import { durations, timeLeft } from './status.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const OVERDUE_WINDOW = 24 * HOUR;
const COMBINE_ABOVE = 3;
const LIST_LINES = 6;

export const RULE_DEFAULTS = { dueSoon: true, strong: true, strongHours: 5, strongVolume: 10, repeat: true, overdue: true, messages: false };
export const QUIET_DEFAULTS = { on: false, from: '23:00', to: '08:00' };
export const STRONG_LIMITS = [1, 24];
/** 没交就再提醒: strong again at these hours left (only those below N). */
export const REPEAT_HOURS = [2, 1];
/**
 * Bark's critical-alert volume. It ignores the silent switch and the volume
 * buttons; 5 is about a normal ringtone, so nothing lower is offered.
 */
export const VOLUME_LIMITS = [5, 10];

/** "HH:MM" to minutes after midnight, or NaN. */
export function minutesOf(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Minutes after local midnight at `now`, in the given time zone (default: the computer's). */
function localMinutes(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

/** True inside the quiet hours; a range like 23:00-08:00 runs past midnight. */
export function isQuiet(now, quiet = QUIET_DEFAULTS, timeZone) {
  if (!quiet?.on) return false;
  const from = minutesOf(quiet.from);
  const to = minutesOf(quiet.to);
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return false;
  const m = localMinutes(now, timeZone);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** 10月23日周五 14:00 */
export function localTime(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('month')}月${get('day')}日${get('weekday')} ${get('hour')}:${get('minute')}`;
}

/** "还剩 5 小时" -> "5 小时", for 「有 1 项作业 5 小时后截止」. */
const spanLeft = (item, now) => timeLeft(item, now).replace(/^还剩\s*/, '');

const sentKey = (key, rule) => `${key}#${rule}`;

/**
 * The strong alerts in order: N hours left, then (没交就再提醒) 2 and 1 hour
 * left, only those smaller than N. Rule names are what the sent log keeps.
 */
function strongSteps(rules) {
  const strongHours = rules.strongHours ?? RULE_DEFAULTS.strongHours;
  const steps = [{ rule: 'strong', hours: strongHours }];
  if (rules.repeat) for (const h of REPEAT_HOURS) if (h < strongHours) steps.push({ rule: `strong${h}h`, hours: h, repeat: true });
  return steps;
}

/**
 * Which rule each unsubmitted assignment is due for now, if any:
 * strong (N hours left, then again at 2 and 1 hour left), dueSoon (turned
 * orange) or overdue (within the last 24 hours). Each fires once; a strong
 * alert also covers turning orange and any earlier strong step it skipped
 * (alerts switched on late, or the computer was asleep).
 */
function itemAlerts(todo, now, settings, rules, sentItems, ignored = {}) {
  const { dueSoonHours } = durations(settings);
  const steps = rules.strong ? strongSteps(rules) : [];
  const was = (key, rule) => Boolean(sentItems[sentKey(key, rule)]);
  const out = [];
  for (const item of todo ?? []) {
    if (item.submitted || !item.key || !item.due) continue;
    const left = Date.parse(item.due) - now;
    if (Number.isNaN(left)) continue;
    if (left <= 0) {
      // Ignored on this computer (忽略): no overdue alert for it.
      if (ignored[item.key]) continue;
      if (rules.overdue && -left <= OVERDUE_WINDOW && !was(item.key, 'overdue')) {
        out.push({ item, rule: 'overdue', strong: false, records: [sentKey(item.key, 'overdue')] });
      }
      continue;
    }
    // The most urgent step reached so far; the steps before it count as done with it.
    const reached = steps.findLastIndex((s) => left <= s.hours * HOUR);
    if (reached >= 0) {
      const step = steps[reached];
      if (!was(item.key, step.rule)) {
        const records = [...steps.slice(0, reached + 1).map((s) => sentKey(item.key, s.rule)), sentKey(item.key, 'dueSoon')];
        out.push({ item, rule: step.rule, strong: true, repeat: Boolean(step.repeat && was(item.key, 'strong')), records });
      }
      continue;
    }
    // Turning orange after the strong alert already rang would only repeat it.
    if (rules.dueSoon && left <= dueSoonHours * HOUR && !was(item.key, 'dueSoon') && !was(item.key, 'strong')) {
      out.push({ item, rule: 'dueSoon', strong: false, records: [sentKey(item.key, 'dueSoon')] });
    }
  }
  return out.sort((a, b) => a.item.due.localeCompare(b.item.due));
}

function oneItem({ item, rule, strong, repeat }, now, hideNames, timeZone) {
  const left = timeLeft(item, now);
  if (hideNames) {
    return {
      title: rule === 'overdue' ? '有 1 项作业已逾期' : `${strong ? '⚠️ ' : ''}有 1 项作业 ${spanLeft(item, now)}后截止`,
      body: rule === 'overdue' ? '打开电脑上的面板看看是哪一项。' : '还没有提交，打开电脑上的面板看看是哪一项。',
    };
  }
  const when = `截止：${localTime(item.due, timeZone)}（${left}）`;
  if (rule === 'overdue') return { title: `已逾期：${item.title}`, body: `${item.course}\n${when}\n如果还能补交，尽快提交。`, url: item.link };
  if (strong) return { title: `⚠️ ${repeat ? '再次提醒，' : ''}还没交：${item.title}`, body: `${item.course}\n${when}\n快去提交！`, url: item.link };
  return { title: `作业快到期：${item.title}`, body: `${item.course}\n${when}`, url: item.link };
}

function listBody(lines) {
  const shown = lines.slice(0, LIST_LINES);
  if (lines.length > LIST_LINES) shown.push(`……另外 ${lines.length - LIST_LINES} 项`);
  return shown.join('\n');
}

function combinedItems(found, now, hideNames) {
  const n = found.length;
  const strong = found[0].strong;
  const allOverdue = found.every((f) => f.rule === 'overdue');
  const upcoming = found.filter((f) => f.rule !== 'overdue');
  const nearest = (upcoming[0] ?? found[0]).item;
  const what = allOverdue ? '已逾期' : strong ? '快截止了还没交' : upcoming.length === n ? '快到期' : '需要注意';
  const title = `${strong ? '⚠️ ' : ''}${n} 项作业${what}`;
  if (hideNames) {
    return {
      title: upcoming.length ? `${title}，最近的 ${spanLeft(nearest, now)}后截止` : title,
      body: '打开电脑上的面板看看是哪几项。',
    };
  }
  return {
    title: `${title}：${found.slice(0, 2).map((f) => f.item.title).join('、')}${n > 2 ? ' 等' : ''}`,
    body: listBody(found.map((f) => `· ${f.item.title}（${timeLeft(f.item, now)}）`)),
    url: nearest.link,
  };
}

/** Alerts for one group: each on its own, or one combined alert above three. */
function itemGroup(found, now, hideNames, timeZone) {
  if (!found.length) return [];
  const level = found[0].strong ? 'strong' : 'normal';
  const records = (list) => list.flatMap((f) => f.records);
  if (found.length > COMBINE_ABOVE) {
    return [{ level, group: '作业', ...combinedItems(found, now, hideNames), records: records(found) }];
  }
  return found.map((f) => ({ level, group: '作业', ...oneItem(f, now, hideNames, timeZone), records: records([f]) }));
}

const threadId = (t) => `${t.courseId}|${t.id}`;

/**
 * New course messages since the last check. The first check after turning
 * this on (sentThreads undefined) only remembers where things stand, and
 * only messages from the last 24 hours count.
 * Sender and course only, never the message text.
 */
function messageAlerts(threads, sentThreads, quiet, now) {
  const updates = {};
  const found = [];
  let waiting = 0;
  for (const t of threads ?? []) {
    if (!t?.id || !t.time) continue;
    const id = threadId(t);
    const before = sentThreads?.[id];
    if (sentThreads && before && t.time <= before) continue;
    // Only messages from the last day: a thread the log has forgotten is not news.
    const old = now - Date.parse(t.time) > OVERDUE_WINDOW;
    if (!sentThreads || old || t.from === '我' || !(t.unread > 0)) updates[id] = t.time;
    else if (quiet) waiting += 1;
    else found.push(t);
  }
  const records = (list) => list.map((t) => ({ thread: threadId(t), time: t.time }));
  let alerts = found.map((t) => ({
    level: 'normal', group: '消息', title: `新课程消息：${t.from}`, body: t.course, url: t.link, records: records([t]),
  }));
  if (found.length > COMBINE_ABOVE) {
    alerts = [{
      level: 'normal',
      group: '消息',
      title: `${found.length} 条新课程消息`,
      body: listBody(found.map((t) => `· ${t.from}（${t.course}）`)),
      url: found[0].link,
      records: records(found),
    }];
  }
  return { alerts, updates, waiting };
}

/**
 * The alerts to send now.
 *   todo: overview items { key, title, course, due, submitted, link }
 *   threads: message threads, only when message alerts are on
 *   settings: the timeline durations (dueSoonHours)
 *   push: { rules, hideNames, quiet }
 *   sent: { items: { "key#rule": iso }, threads: { "course|thread": time } | undefined }
 *   ignored: { key: { at } }, overdue assignments the student chose to ignore (no overdue alert)
 * Returns { alerts, threadUpdates, waiting }. Each alert carries `records`:
 * what to write to the sent log once it has actually been sent. Normal alerts
 * wait during quiet hours (nothing recorded, so they go at the first check
 * after); strong alerts still go.
 */
export function planAlerts({ todo, threads, now = Date.now(), settings = {}, push = {}, sent = {}, ignored = {}, timeZone } = {}) {
  const rules = { ...RULE_DEFAULTS, ...push.rules };
  const quiet = isQuiet(now, { ...QUIET_DEFAULTS, ...push.quiet }, timeZone);
  const found = itemAlerts(todo, now, settings, rules, sent.items ?? {}, ignored);
  const strong = found.filter((f) => f.strong);
  const normal = found.filter((f) => !f.strong);
  const alerts = [
    ...itemGroup(strong, now, push.hideNames, timeZone),
    ...(quiet ? [] : itemGroup(normal, now, push.hideNames, timeZone)),
  ];
  let threadUpdates = {};
  let waiting = quiet ? normal.length : 0;
  if (rules.messages && threads) {
    const m = messageAlerts(threads, sent.threads, quiet, now);
    alerts.push(...m.alerts);
    threadUpdates = m.updates;
    waiting += m.waiting;
  }
  return { alerts, threadUpdates, waiting };
}
