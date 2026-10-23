import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCourseIds, pastCourseIds, splitByTerm, termKey } from '../lib/terms.js';

// Made-up course names in the same shape as real ones.
const NOW = Date.parse('2026-10-23T12:00:00Z');
const course = (id, name, term) => ({ id, name, ...(term ? { term } : {}) });
const pastIds = (courses, opts = {}) => [...pastCourseIds(courses, { now: NOW, ...opts })].sort();

test('term names: months and seasons, in order', () => {
  assert.equal(termKey('FT MSBA - Statistics - October 2026 Term'), 2026 * 12 + 10);
  assert.equal(termKey('July 2026 Term'), 2026 * 12 + 7);
  assert.equal(termKey('FT MSc - Marketing - Autumn 2026 Term (Lecture B)'), 2026 * 12 + 9);
  assert.equal(termKey('Sept 2026 Semester'), 2026 * 12 + 9);
  assert.equal(termKey('fall 2026 term'), 2026 * 12 + 9, 'any case');
  assert.ok(termKey('Spring 2027 Term') > termKey('Winter 2027 Term'));
  assert.ok(termKey('Autumn 2026 Term') > termKey('Summer 2026 Term'));
  for (const name of ['Exam - Macroeconomics (FT MSc) - Sep 2026 Exam Board', 'FT MSBA - Statistics', 'Autumn Term', '', undefined]) {
    assert.equal(termKey(name), null, String(name));
  }
});

test('with dates: past once the term has ended', () => {
  const courses = [
    course('a', 'Statistics', { name: 'T1', start: '2026-06-01T00:00:00Z', end: '2026-09-30T00:00:00Z' }),
    course('b', 'Marketing', { name: 'T2', start: '2026-09-15T00:00:00Z', end: '2027-01-15T00:00:00Z' }),
    course('c', 'Finance', { name: 'T3', start: '2027-01-20T00:00:00Z', end: '2027-05-01T00:00:00Z' }),
  ];
  assert.deepEqual(pastIds(courses), ['a'], 'next term (c) is not hidden either');
});

test('with dates: two terms that overlap are both this term', () => {
  const courses = [
    course('a', 'Statistics', { start: '2026-07-01T00:00:00Z', end: '2026-10-31T00:00:00Z' }),
    course('b', 'Marketing', { start: '2026-10-01T00:00:00Z', end: '2027-01-31T00:00:00Z' }),
  ];
  assert.deepEqual(pastIds(courses), []);
});

test('without dates: the latest term that has started is this term', () => {
  const courses = [
    course('a', 'FT MSBA - Business Statistics - July 2026 Term'),
    course('b', 'FT MSBA - Descriptive Analytics - October 2026 Term'),
    course('c', 'FT MSBA - Data Collection - April 2026 Term'),
    // Next term's course already visible: it has not started, so it is not "this term" and not hidden.
    course('d', 'FT MSBA - Predictive Analytics - January 2027 Term'),
  ];
  assert.deepEqual(pastIds(courses), ['a', 'c']);
  // Blackboard's term name counts before the course name.
  assert.deepEqual(pastIds([course('x', 'Statistics', { name: 'July 2026 Term' }), course('y', 'Marketing', { name: 'Autumn 2026 Term' })]), ['x']);
});

test('without dates: overlapping terms by name keep the older one only if it still needs the student', () => {
  const courses = [course('a', 'FT MSBA - Statistics - September 2026 Term'), course('b', 'FT MSBA - Marketing - October 2026 Term')];
  assert.deepEqual(pastIds(courses), ['a']);
  assert.deepEqual(pastIds(courses, { active: new Set(['a']) }), []);
});

test('no term at all: shown as this term', () => {
  const courses = [
    course('a', 'Exam - Macroeconomics (FT MSc) - Sep 2026 Exam Board'),
    course('b', 'Introduction to Finance'),
    course('c', 'FT MSBA - Statistics - July 2026 Term'),
    course('d', 'FT MSBA - Marketing - Autumn 2026 Term'),
  ];
  assert.deepEqual(pastIds(courses), ['c']);
  assert.deepEqual(pastIds([course('a', 'Statistics', { name: '' })]), []);
  assert.deepEqual(pastIds([]), []);
});

test('only future terms: nothing is hidden', () => {
  assert.deepEqual(pastIds([course('a', 'Marketing - January 2027 Term'), course('b', 'Finance - April 2027 Term')]), []);
});

test('some courses with dates, some by name', () => {
  const courses = [
    course('a', 'Statistics', { start: '2026-05-01T00:00:00Z', end: '2026-08-31T00:00:00Z' }),
    course('b', 'Marketing - July 2026 Term'),
    course('c', 'Finance - Autumn 2026 Term'),
    // Dates win over the name: this one has not ended.
    course('d', 'Old - July 2026 Term', { start: '2026-07-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }),
  ];
  assert.deepEqual(pastIds(courses), ['a', 'b']);
});

test('an earlier-term course with something still to do stays up top', () => {
  const now = NOW;
  const active = activeCourseIds({
    now,
    todo: [
      { courseId: 'a', due: '2026-10-30T00:00:00Z' }, // not yet due
      { courseId: 'b', due: '2026-10-30T00:00:00Z', submitted: true }, // handed in
      { courseId: 'c', due: '2026-10-01T00:00:00Z' }, // already overdue
    ],
    threads: [{ courseId: 'd', unread: 2 }, { courseId: 'e', unread: 0 }],
    grades: [{ courseId: 'f', items: [{ text: '等待评分' }] }, { courseId: 'g', items: [{ text: '8/10' }] }],
  });
  assert.deepEqual([...active].sort(), ['a', 'd', 'f']);
  const courses = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => course(id, `Course ${id} - July 2026 Term`));
  courses.push(course('now', 'Marketing - October 2026 Term'));
  assert.deepEqual(pastIds(courses, { active }), ['b', 'c', 'e', 'g']);
  assert.deepEqual([...activeCourseIds()], []);
});

test('splitting a list keeps its order', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.deepEqual(splitByTerm(list, new Set([2, 4])), { current: [{ id: 1 }, { id: 3 }], earlier: [{ id: 2 }, { id: 4 }] });
  const threads = [{ courseId: 'x' }, { courseId: 'y' }];
  assert.deepEqual(splitByTerm(threads, new Set(['y']), (t) => t.courseId).earlier, [{ courseId: 'y' }]);
});
