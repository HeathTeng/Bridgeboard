// Which rows the checklist shows and in what order. No Node-only code: the
// page loads this file as /checklist-rows.js, next to /status.js.

const DAY = 24 * 60 * 60 * 1000;
export const DONE_DROP_DAYS = 14;

/**
 * Assignments for the checklist: only those already open (an unknown opening
 * time means it was already there), done when Blackboard shows a submission
 * or the student ticked it here, and finished work dropped 14 days after its
 * due date.
 */
export function assignmentRows(todo, marks = {}, now = Date.now()) {
  return todo
    .filter((t) => !t.opened || Date.parse(t.opened) <= now)
    .map((t) => {
      const manual = !t.submitted && Boolean(t.key && marks[t.key]);
      return { ...t, done: Boolean(t.submitted) || manual, manual };
    })
    .filter((t) => !(t.done && Date.parse(t.due) < now - DONE_DROP_DAYS * DAY));
}

/** Open items: dated ones by due time first, then the rest in the order added. Done: latest first. */
export function sortRows(rows, created = (r) => r.createdAt ?? '') {
  const open = rows.filter((r) => !r.done).sort((a, b) => {
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due || b.due) return a.due ? -1 : 1;
    return created(a).localeCompare(created(b));
  });
  const done = rows.filter((r) => r.done).sort((a, b) => (b.doneAt ?? b.due ?? '').localeCompare(a.doneAt ?? a.due ?? ''));
  return { open, done };
}
