// Five-colour deadline status and the "time left" label. No Node-only code:
// the page loads this same file (served as /status.js), so labels stay live.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** newHours 0 means "opened today" (local date); otherwise a window in hours. */
export const DEFAULTS = { newHours: 0, dueSoonHours: 12 };
export const LIMITS = { newHours: [6, 72], dueSoonHours: [1, 72] };

/** Order the page shows the groups in, with their text labels. */
export const STATUSES = ['overdue', 'dueSoon', 'new', 'open', 'done'];

/** Fills in defaults and drops anything outside the allowed range. */
export function durations(settings = {}) {
  const ok = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;
  return {
    newHours: settings.newHours === 0 || ok(settings.newHours, LIMITS.newHours) ? settings.newHours : DEFAULTS.newHours,
    dueSoonHours: ok(settings.dueSoonHours, LIMITS.dueSoonHours) ? settings.dueSoonHours : DEFAULTS.dueSoonHours,
  };
}

function sameLocalDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/**
 * One status per item, first match wins: done, overdue, dueSoon, new, open.
 * item: { due: ISO, submitted?: boolean, opened?: ISO }.
 */
export function statusOf(item, now = Date.now(), settings = {}) {
  const { newHours, dueSoonHours } = durations(settings);
  if (item.submitted) return 'done';
  const due = Date.parse(item.due);
  if (due <= now) return 'overdue';
  if (due - now <= dueSoonHours * HOUR) return 'dueSoon';
  const opened = item.opened ? Date.parse(item.opened) : NaN;
  if (opened <= now) {
    if (newHours === 0 ? sameLocalDay(opened, now) : now - opened <= newHours * HOUR) return 'new';
  }
  return 'open';
}

function span(ms) {
  if (ms >= DAY) return `${Math.floor(ms / DAY)} 天`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} 小时`;
  return `${Math.floor(ms / MINUTE)} 分钟`;
}

/** 还剩 3 天 / 还剩 5 小时 / 还剩 40 分钟 / 已逾期 2 天 / 已提交 */
export function timeLeft(item, now = Date.now()) {
  if (item.submitted) return '已提交';
  const diff = Date.parse(item.due) - now;
  if (diff > 0) return diff < MINUTE ? '还剩不到 1 分钟' : `还剩 ${span(diff)}`;
  return -diff < MINUTE ? '刚刚截止' : `已逾期 ${span(-diff)}`;
}

/**
 * The short text in a deadline capsule: 逾期 2 天 / 6 小时 / 刚开放 · 12 天 /
 * 9 天 / 已完成. The group heading above says what the colour means.
 */
export function pillText(item, status, now = Date.now()) {
  if (item.submitted || status === 'done') return '已完成';
  const diff = Date.parse(item.due) - now;
  if (diff <= 0) return -diff < MINUTE ? '刚刚截止' : `逾期 ${span(-diff)}`;
  const left = diff < MINUTE ? '不到 1 分钟' : span(diff);
  return status === 'new' ? `刚开放 · ${left}` : left;
}

/** Group headings, which also say what the colour means. */
export function statusLabel(status, settings = {}) {
  const { newHours, dueSoonHours } = durations(settings);
  return {
    overdue: '已逾期',
    dueSoon: `${dueSoonHours} 小时内截止`,
    new: newHours === 0 ? '今天新开放' : `${newHours} 小时内新开放`,
    open: '进行中',
    done: '已提交',
  }[status];
}
