// The one line each section shows when folded, and the 今天要注意 chips.
// Computed from data already on the page. No Node-only code: the page loads
// this file as /section-summary.js, next to /status.js.
import { timeLeft } from './status.js';

export const LOADING = '正在读取…';
export const SIGNED_OUT = '连接 Blackboard 后显示';

/** The first few characters of a text, with … when cut. */
export function firstWords(text, n = 14) {
  const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

/** rows: [{ due, submitted, status }] with status from statusOf. */
export function deadlinesSummary(rows, now = Date.now()) {
  const overdue = rows.filter((r) => r.status === 'overdue').length;
  const soon = rows.filter((r) => r.status === 'dueSoon').length;
  const next = rows.filter((r) => !r.submitted && Date.parse(r.due) > now)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0];
  const parts = [];
  if (overdue) parts.push(`${overdue} 项逾期`);
  if (soon) parts.push(`${soon} 项临期`);
  if (next) parts.push(`最近一项${timeLeft(next, now)}`);
  return parts.length ? parts.join(' · ') : '最近没有要交的作业';
}

/** open: things not done yet; total: everything on the list. */
export function checklistSummary(open, total) {
  if (open) return `还有 ${open} 件没做`;
  return total ? '都做完了' : '清单是空的，点开添加';
}

/** threads: [{ unread, from, preview, time }]. */
export function messagesSummary(threads) {
  const unread = threads.filter((t) => t.unread > 0);
  const count = unread.reduce((n, t) => n + t.unread, 0);
  if (!count) return '没有未读消息';
  const latest = [...unread].sort((a, b) => String(b.time ?? '').localeCompare(String(a.time ?? '')))[0];
  return `${count} 条未读 · 最新：${latest.from || '—'}「${firstWords(latest.preview)}」`;
}

/** list: announcements, newest first. */
export function announcementsSummary(list) {
  if (!list.length) return '最近没有公告';
  return `最近 ${list.length} 条 · ${firstWords(list[0].title, 30)}`;
}

/** courses: [{ items: [{ text }] }], this term only. */
export function gradesSummary(courses) {
  const withItems = courses.filter((c) => c.items.length);
  if (!withItems.length) return '还没有成绩';
  const waiting = withItems.reduce((n, c) => n + c.items.filter((i) => i.text === '等待评分').length, 0);
  return `${withItems.length} 门课${waiting ? ` · ${waiting} 项等待评分` : ''}`;
}

/** courseCount: this term's courses; folder: the saved download folder, if any. */
export function filesSummary(courseCount, folder) {
  const where = folder ? `保存到 ${folder}` : '还没选择保存位置';
  return courseCount ? `${courseCount} 门课可下载 · ${where}` : `没有找到课程 · ${where}`;
}

const PROVIDERS = { bark: 'Bark', ntfy: 'ntfy' };

/** push: { enabled, provider } from /api/push. */
export function alertsSummary(push) {
  if (push?.enabled) return `已打开 · ${PROVIDERS[push.provider] ?? push.provider}`;
  return '还没打开 · 3 步就能让作业快到期时手机响';
}

/**
 * Up to three chips for 今天要注意: overdue, due soon, unread messages.
 * rows: deadline rows with status (soonest first); threads: message threads;
 * courseName: how to show a course name. Each chip: { section, status, text }.
 */
export function todayChips({ rows = [], threads = [], now = Date.now(), courseName = (n) => n } = {}) {
  const chips = [];
  const byDue = [...rows].sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  const overdue = byDue.filter((r) => r.status === 'overdue');
  // The most recent overdue item first: the one most likely still to hand in.
  if (overdue.length) {
    const first = overdue.at(-1);
    chips.push({ section: 'deadlines', status: 'overdue', text: `${overdue.length} 项逾期 · ${firstWords(first.title, 24)} · ${timeLeft(first, now)}` });
  }
  const soon = byDue.filter((r) => r.status === 'dueSoon');
  if (soon.length) {
    chips.push({ section: 'deadlines', status: 'dueSoon', text: `${soon.length} 项临期 · ${firstWords(soon[0].title, 24)} · ${timeLeft(soon[0], now)}` });
  }
  const unread = threads.filter((t) => t.unread > 0);
  const count = unread.reduce((n, t) => n + t.unread, 0);
  if (count) {
    const courses = [...new Set(unread.map((t) => t.course))];
    const where = courses.length > 1 ? `${courseName(courses[0])} 等 ${courses.length} 门课` : courseName(courses[0]);
    chips.push({ section: 'messages', status: 'new', text: `${count} 条未读消息 · ${where}` });
  }
  return chips;
}

export const NOTHING_TODAY = '今天没有要紧的事';
