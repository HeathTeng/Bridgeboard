// Phone alerts through Bark (iPhone) or ntfy (Android): checking what the
// student typed, masking it for the page, sending, and the sent log.
// The Bark key and ntfy topic work like passwords: never log them.
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { QUIET_DEFAULTS, RULE_DEFAULTS, STRONG_LIMITS, VOLUME_LIMITS, minutesOf } from './push-rules.js';

/**
 * The strong-alert volume, 5-10. Missing means the default (10); anything
 * below 5 or not a number becomes 5, so a strong alert is never too quiet.
 */
export function strongVolumeOf(v) {
  if (v === undefined) return RULE_DEFAULTS.strongVolume;
  const [min, max] = VOLUME_LIMITS;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) return min;
  return Math.min(max, Math.round(v));
}

export const BARK_SERVER = 'https://api.day.app';
export const NTFY_SERVER = 'https://ntfy.sh';
export const PROVIDERS = ['bark', 'ntfy'];
export const SENT_FILE = join(homedir(), '.blackboard-study-hub', 'push-sent.json');
export const TEST_MESSAGE = '测试成功 ✅ 以后作业快到期时，手机会这样提醒你。';
// Bark's built-in ringtones: alarm is the loudest.
const STRONG_SOUND = 'alarm';
// The on/off rules the page can change.
const SWITCHES = ['dueSoon', 'strong', 'repeat', 'overdue', 'messages'];

const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;
const BARK_KEY = /^[A-Za-z0-9]{8,64}$/;
const TOPIC = /^[A-Za-z0-9_-]{8,64}$/;

export const PUSH_DEFAULTS = {
  enabled: false,
  provider: 'bark',
  bark: { server: BARK_SERVER, key: '' },
  ntfy: { server: NTFY_SERVER, topic: '' },
  tested: '',
  rules: RULE_DEFAULTS,
  hideNames: false,
  quiet: QUIET_DEFAULTS,
};

function bad(message, code = 'BAD_INPUT') {
  return Object.assign(new Error(message), { status: 400, code });
}

/**
 * A server address the student typed: https only, no user name or password,
 * nothing after the host. Returns the origin, e.g. https://push.example.com.
 */
export function checkServer(text) {
  let url;
  try {
    url = new URL(String(text ?? '').trim());
  } catch {
    throw bad('服务器地址不对，应该像 https://ntfy.example.com 这样。');
  }
  if (url.protocol !== 'https:') throw bad('服务器地址必须以 https:// 开头。');
  if (url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
    throw bad('服务器地址只填到域名为止，例如 https://ntfy.example.com。');
  }
  return url.origin;
}

/**
 * What the student pasted from Bark: the whole link Bark shows
 * (https://api.day.app/xxxx/ or with a sample message after it) or only the
 * key. Returns { server, key }. A link from another https server counts as
 * a self-hosted Bark server.
 */
export function parseBark(text) {
  const raw = String(text ?? '').replace(/\s+/g, '');
  if (!raw) throw bad('请先粘贴 Bark 里显示的链接。');
  if (BARK_KEY.test(raw)) return { server: BARK_SERVER, key: raw };
  const link = /https?:\/\/[^\s"'<>]+/i.exec(raw)?.[0] ?? (raw.includes('/') ? `https://${raw}` : '');
  let url;
  try {
    url = new URL(link);
  } catch {
    throw bad('没认出 Bark 的链接。请在 Bark 里复制整条 https://api.day.app/… 链接，再粘贴到这里。');
  }
  if (url.protocol !== 'https:') throw bad('Bark 链接必须以 https:// 开头。');
  const key = url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!BARK_KEY.test(key)) {
    throw bad('链接里没找到密钥。请复制 Bark 首页显示的整条链接（https://api.day.app/ 后面跟着一串字母数字）。');
  }
  return { server: checkServer(url.origin), key };
}

/** bb- plus 16 random lowercase letters: long enough that nobody can guess it. */
export function newTopic() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return `bb-${Array.from({ length: 16 }, () => letters[randomInt(letters.length)]).join('')}`;
}

export function checkTopic(topic) {
  if (!TOPIC.test(String(topic ?? ''))) throw bad('频道名不对，请点「换一个」生成新的。');
  return topic;
}

/** ••••a1b2: enough to recognise, not enough to use. */
export function mask(secret) {
  return secret ? `••••${String(secret).slice(-4)}` : '';
}

/** Where alerts go now: { provider, server, secret, volume }, or null when not filled in. */
export function targetOf(push) {
  if (push.provider === 'ntfy') return push.ntfy?.topic ? { provider: 'ntfy', server: push.ntfy.server || NTFY_SERVER, secret: push.ntfy.topic } : null;
  const volume = strongVolumeOf(push.rules?.strongVolume);
  return push.bark?.key ? { provider: 'bark', server: push.bark.server || BARK_SERVER, secret: push.bark.key, volume } : null;
}

/** A short fingerprint of the target, so the settings remember which one passed the test. */
export function fingerprint(target) {
  if (!target) return '';
  return createHash('sha256').update(`${target.provider}|${target.server}|${target.secret}`).digest('hex').slice(0, 16);
}

export const isTested = (push) => Boolean(push.tested) && push.tested === fingerprint(targetOf(push));

/** Saved push settings with defaults filled in; anything broken falls back to the default. */
export function pushOf(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const rules = { ...RULE_DEFAULTS };
  for (const k of SWITCHES) if (typeof s.rules?.[k] === 'boolean') rules[k] = s.rules[k];
  const h = s.rules?.strongHours;
  if (Number.isInteger(h) && h >= STRONG_LIMITS[0] && h <= STRONG_LIMITS[1]) rules.strongHours = h;
  // Older settings may hold 1-4: those become 5.
  rules.strongVolume = strongVolumeOf(s.rules?.strongVolume);
  const quiet = { ...QUIET_DEFAULTS };
  if (typeof s.quiet?.on === 'boolean') quiet.on = s.quiet.on;
  for (const k of ['from', 'to']) if (!Number.isNaN(minutesOf(s.quiet?.[k]))) quiet[k] = s.quiet[k];
  const push = {
    enabled: s.enabled === true,
    provider: PROVIDERS.includes(s.provider) ? s.provider : PUSH_DEFAULTS.provider,
    bark: { server: s.bark?.server || BARK_SERVER, key: BARK_KEY.test(s.bark?.key ?? '') ? s.bark.key : '' },
    ntfy: { server: s.ntfy?.server || NTFY_SERVER, topic: TOPIC.test(s.ntfy?.topic ?? '') ? s.ntfy.topic : '' },
    tested: typeof s.tested === 'string' ? s.tested : '',
    rules,
    hideNames: s.hideNames === true,
    quiet,
  };
  // Never switched on without a target that passed the test.
  if (!isTested(push)) push.enabled = false;
  return push;
}

/**
 * Applies a change from the page's switches. Only these keys may change
 * here; the key, topic and server change through the test and topic routes.
 */
export function applyPatch(push, patch) {
  if (!patch || typeof patch !== 'object') throw bad('设置的格式不对，请刷新页面再试。');
  const next = structuredClone(push);
  if ('provider' in patch) {
    if (!PROVIDERS.includes(patch.provider)) throw bad('请选择苹果手机或安卓手机。');
    if (patch.provider !== next.provider) next.enabled = false;
    next.provider = patch.provider;
  }
  if ('rules' in patch) {
    const r = patch.rules ?? {};
    for (const k of SWITCHES) {
      if (k in r) {
        if (typeof r[k] !== 'boolean') throw bad('开关的设置不对，请刷新页面再试。');
        next.rules[k] = r[k];
      }
    }
    if ('strongHours' in r) {
      const h = r.strongHours;
      if (!Number.isInteger(h) || h < STRONG_LIMITS[0] || h > STRONG_LIMITS[1]) throw bad('强提醒的时间要在 1 到 24 小时之间。');
      next.rules.strongHours = h;
    }
    if ('strongVolume' in r) next.rules.strongVolume = strongVolumeOf(r.strongVolume ?? VOLUME_LIMITS[0]);
  }
  if ('hideNames' in patch) next.hideNames = patch.hideNames === true;
  if ('quiet' in patch) {
    const q = patch.quiet ?? {};
    if ('on' in q) next.quiet.on = q.on === true;
    for (const k of ['from', 'to']) {
      if (k in q) {
        if (Number.isNaN(minutesOf(q[k]))) throw bad('安静时段的时间不对，请用 23:00 这样的格式。');
        next.quiet[k] = q[k];
      }
    }
    if (next.quiet.from === next.quiet.to) throw bad('安静时段的开始和结束不能是同一个时间。');
  }
  if ('enabled' in patch) {
    if (patch.enabled === true && !isTested(next)) throw bad('请先点「发一条测试」，确认手机收到了，再打开提醒。', 'NOT_TESTED');
    next.enabled = patch.enabled === true;
  }
  return next;
}

/** What the page sees: everything except the secrets, which are masked. */
export function pushView(push, { showTopic = false } = {}) {
  const tested = isTested(push);
  return {
    enabled: push.enabled,
    provider: push.provider,
    tested,
    bark: { keyMask: mask(push.bark.key), server: push.bark.server, custom: push.bark.server !== BARK_SERVER },
    ntfy: {
      // A new topic is shown in full until it passes the test: the student has to type it into the phone.
      topic: showTopic || (push.ntfy.topic && !(tested && push.provider === 'ntfy')) ? push.ntfy.topic : '',
      topicMask: mask(push.ntfy.topic),
      server: push.ntfy.server,
      custom: push.ntfy.server !== NTFY_SERVER,
    },
    rules: push.rules,
    hideNames: push.hideNames,
    quiet: push.quiet,
  };
}

// ---- Sending ----

/**
 * The request for one alert. Only https, and only the Bark or ntfy server
 * the student chose. alert: { title, body, url?, level: 'normal'|'strong', group? }.
 */
export function buildRequest(target, alert) {
  const server = checkServer(target.server);
  const link = /^https:\/\//.test(alert.url ?? '') ? alert.url : undefined;
  const strong = alert.level === 'strong';
  if (target.provider === 'bark') {
    return {
      url: `${server}/push`,
      body: {
        device_key: target.secret,
        title: alert.title,
        body: alert.body || ' ',
        group: alert.group ?? 'Blackboard',
        ...(link && { url: link }),
        // critical rings even on silent, at its own volume; call keeps it ringing; alarm is the loudest sound.
        // timeSensitive gets through Focus modes, but follows the silent switch.
        ...(strong ? { level: 'critical', call: '1', volume: strongVolumeOf(target.volume), sound: STRONG_SOUND } : { level: 'timeSensitive' }),
      },
    };
  }
  return {
    url: `${server}/`,
    body: {
      topic: target.secret,
      title: alert.title,
      message: alert.body || alert.title,
      priority: strong ? 5 : 3,
      tags: [strong ? 'warning' : 'books'],
      ...(link && { click: link }),
    },
  };
}

function sendError(code) {
  const text = {
    offline: '没有发出去：这台电脑好像没联网，或者连不上提醒服务器。检查网络后再试。',
    badKey: '没有发出去：密钥不对。请在 Bark 里重新复制整条链接，粘贴后再试。',
    refused: '没有发出去：提醒服务器拒绝了这次发送。等几分钟再试；一直这样的话，换一个频道名或检查服务器地址。',
  }[code];
  return Object.assign(new Error(text), { status: 502, code: `PUSH_${code.toUpperCase()}` });
}

async function postOnce(request, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    throw sendError('offline');
  }
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  // Bark answers 400 "failed to get device token" for an unknown key.
  if (/device|token/i.test(text) && res.status >= 400 && res.status < 500) throw sendError('badKey');
  throw Object.assign(sendError('refused'), { httpStatus: res.status });
}

/** Sends one alert: 10-second timeout, one retry. Throws a plain-Chinese error. */
export async function sendAlert(target, alert, { fetchImpl = fetch } = {}) {
  const request = buildRequest(target, alert);
  try {
    await postOnce(request, fetchImpl);
  } catch (err) {
    if (err.code === 'PUSH_BADKEY') throw err;
    await postOnce(request, fetchImpl);
  }
}

// ---- Sent log ----

/** { items: { "key#rule": iso }, threads: { "course|thread": time } | undefined, login: iso } */
export function loadSent(file = SENT_FILE) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return {
      items: data.items && typeof data.items === 'object' ? data.items : {},
      threads: data.threads && typeof data.threads === 'object' ? data.threads : undefined,
      login: typeof data.login === 'string' ? data.login : undefined,
    };
  } catch {
    return { items: {}, threads: undefined };
  }
}

/** Drops entries older than 60 days, so the file stays small. */
export function pruneSent(sent, now = Date.now()) {
  const fresh = (iso) => !(now - Date.parse(iso) > KEEP_MS);
  const keep = (obj) => obj && Object.fromEntries(Object.entries(obj).filter(([, at]) => fresh(at)));
  return { ...sent, items: keep(sent.items) ?? {}, threads: keep(sent.threads) };
}

/** Temp file then rename, so a crash never leaves half a file. */
export function saveSent(sent, file = SENT_FILE, now = Date.now()) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(pruneSent(sent, now), null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Writes what an alert covered into the sent log (in memory). */
export function record(sent, records, now = Date.now()) {
  const at = new Date(now).toISOString();
  for (const r of records ?? []) {
    if (typeof r === 'string') sent.items[r] = at;
    else if (r?.thread) sent.threads = { ...sent.threads, [r.thread]: r.time };
  }
  return sent;
}
