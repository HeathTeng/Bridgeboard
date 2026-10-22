// Filters and times for the 课程消息 list. No Node-only code: the page loads
// this file as /message-view.js, next to /status.js.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** 全部 / 未读, and optionally one course. */
export function filterThreads(threads, { unreadOnly = false, courseId = '' } = {}) {
  return threads.filter((t) => (!unreadOnly || t.unread > 0) && (!courseId || t.courseId === courseId));
}

/** The courses that have messages, for the dropdown, by name. */
export function courseOptions(threads) {
  const seen = new Map();
  for (const t of threads) if (!seen.has(t.courseId)) seen.set(t.courseId, t.course);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

const pad = (n) => String(n).padStart(2, '0');
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** 刚刚 / 5 分钟前 / 2 小时前 (same day) / 昨天 14:30 / 3月5日 14:30 / 2025年3月5日, in local time. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < MINUTE) return '刚刚';
  const d = new Date(t);
  const today = dayStart(new Date(now));
  if (t >= today) return diff < HOUR ? `${Math.floor(diff / MINUTE)} 分钟前` : `${Math.floor(diff / HOUR)} 小时前`;
  if (t >= today - 24 * HOUR) return `昨天 ${clock(d)}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock(d)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
