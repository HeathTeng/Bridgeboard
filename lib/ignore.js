// 忽略逾期作业: the student can stop being reminded of an overdue assignment.
// Only this computer remembers it (ignored in checklist.json); Blackboard is
// never changed. No Node-only code: the page loads it as /ignore.js.

/** The × button's hover and screen-reader text. */
export const IGNORE_HINT = '不再提醒这一项（不会改 Blackboard）';

/**
 * Whether a deadline counts as ignored: ignored here, still overdue, and not
 * handed in. Handed in (Blackboard says so) shows as done again; a due date
 * moved into the future puts it back in its colour group.
 * row: { key, submitted, status } with status from statusOf.
 */
export function isIgnored(row, ignored = {}) {
  return row.status === 'overdue' && !row.submitted && Boolean(row.key && ignored[row.key]);
}

/** Deadlines still shown (and counted) and the ones in 已忽略. */
export function splitIgnored(rows, ignored = {}) {
  const shown = [];
  const hidden = [];
  for (const row of rows) (isIgnored(row, ignored) ? hidden : shown).push(row);
  return { shown, ignored: hidden };
}
