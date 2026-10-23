// Which courses belong to an earlier term, so per-course sections can tuck
// them into 往期课程. No Node-only code: the page loads this file as /terms.js.
//
// Rules, in order, for each course:
//  1. Blackboard gave the term with start and end dates: past once the end
//     date has gone by (overlapping terms are simply both current).
//  2. No dates: a term in the term name or course name, such as
//     "Autumn 2026 Term" or "October 2026 Term". The latest term that has
//     already started is this term; only older ones are past, so next
//     term's courses that appear early are not hidden.
//  3. Neither: treated as this term, never hidden.
// A past course with something still to do (an assignment not yet due, an
// unread message, a grade waiting to be marked) stays with this term.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Rough start months, only used to put terms in order.
const SEASONS = { winter: 1, spring: 2, summer: 5, autumn: 9, fall: 9 };
const NAMED = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|winter|spring|summer|autumn|fall)\s+((?:19|20)\d{2})\s+(?:term|semester|trimester)\b/i;

/** "Autumn 2026 Term" -> a number that orders terms (year * 12 + start month), or null. */
export function termKey(text) {
  const m = NAMED.exec(String(text ?? ''));
  if (!m) return null;
  const word = m[1].toLowerCase();
  const month = SEASONS[word] ?? MONTHS.indexOf(word.slice(0, 3)) + 1;
  return Number(m[2]) * 12 + month;
}

const time = (iso) => (iso ? Date.parse(iso) : NaN);

/** { start, end } in ms when Blackboard gave both dates, else null. */
function termDates(course) {
  const start = time(course?.term?.start);
  const end = time(course?.term?.end);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

const monthKey = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() * 12 + d.getMonth() + 1;
};

/**
 * Courses that still need the student: an assignment not submitted and not
 * yet due, an unread message thread, a grade item waiting to be marked.
 * todo: [{ courseId, due, submitted }], threads: [{ courseId, unread }],
 * grades: [{ courseId, items: [{ text }] }].
 */
export function activeCourseIds({ todo = [], threads = [], grades = [], now = Date.now() } = {}) {
  const ids = new Set();
  for (const t of todo) if (t.courseId && !t.submitted && time(t.due) > now) ids.add(t.courseId);
  for (const t of threads) if (t.courseId && t.unread > 0) ids.add(t.courseId);
  for (const g of grades) if (g.courseId && g.items?.some((i) => i.text === '等待评分')) ids.add(g.courseId);
  return ids;
}

/**
 * The ids of courses from an earlier term.
 * courses: [{ id, name, term?: { name?, start?, end? } }]; active: ids to keep shown.
 */
export function pastCourseIds(courses, { now = Date.now(), active = new Set() } = {}) {
  const past = new Set();
  const named = [];
  for (const c of courses) {
    const dates = termDates(c);
    if (dates) {
      if (dates.end < now) past.add(c.id);
      continue;
    }
    const key = termKey(c.term?.name) ?? termKey(c.name);
    if (key != null) named.push({ id: c.id, key });
  }
  const started = named.map((x) => x.key).filter((k) => k <= monthKey(now));
  if (started.length) {
    const current = Math.max(...started);
    for (const x of named) if (x.key < current) past.add(x.id);
  }
  for (const id of active) past.delete(id);
  return past;
}

/** Splits a list into this term and earlier terms, keeping the order. */
export function splitByTerm(list, past, idOf = (x) => x.id) {
  const current = [];
  const earlier = [];
  for (const x of list) (past.has(idOf(x)) ? earlier : current).push(x);
  return { current, earlier };
}
