import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISPLAY_DEFAULTS, SECTIONS, THEMES, checkDisplay, courseParts, displayOf, isOpen, shortCourseName, shortNames } from '../lib/display.js';

// Made-up names in the same shape as real ones.
const MKT_B = 'FT MSc/MBA - Marketing - Group A B C D E - Autumn 2026 Term (Lecture B)';
const STORY = 'FT MSBA - Data Storytelling for Business - Autumn 2026 Term';
const CAPS = 'FT MSc/MBA - BUSINESS ETHICS & STRATEGY 2 - Spring 2026 Term';
const AI = 'FT MSBA - AI Governance - Spring 2026 Term';

test('short names: subject only when the pattern is clear', () => {
  assert.equal(shortCourseName(MKT_B), 'Marketing');
  assert.equal(shortCourseName(STORY), 'Data Storytelling for Business');
  assert.equal(shortCourseName(CAPS), 'BUSINESS ETHICS & STRATEGY 2');
  assert.equal(shortCourseName(AI), 'AI Governance');
  assert.equal(shortCourseName('PT MBA - Corporate Finance - Group F G - Winter 2027 Semester'), 'Corporate Finance');
  assert.deepEqual(courseParts(MKT_B), { prefix: 'FT MSc/MBA', subject: 'Marketing', term: 'Autumn 2026 Term', session: 'Lecture B' });
});

test('names it must leave alone', () => {
  for (const name of [
    'Exam - Macroeconomics (FT MSc) - Sep 2026 Exam Board (Re Sits)', // no programme prefix first
    'Introduction to Finance', // no parts at all
    'FT MSBA - Statistics', // no term
    'FT MSBA - Statistics - Autumn Term', // term without a year
    'FT MSBA - Group A B - Autumn 2026 Term', // nothing but a group between
    'MSBA - Statistics - Autumn 2026 Term', // not FT/PT
    '',
  ]) assert.equal(shortCourseName(name), name, name);
});

test('clashing short names get the lecture, then the programme, else stay full', () => {
  const byLecture = shortNames([
    'FT MSc/MBA - Marketing - Group A B - Autumn 2026 Term (Lecture A)',
    MKT_B,
    STORY,
  ]);
  assert.deepEqual([...byLecture.values()], ['Marketing (Lecture A)', 'Marketing (Lecture B)', 'Data Storytelling for Business']);

  const byProgramme = shortNames(['FT MSc - Marketing - Autumn 2026 Term', 'FT MBA - Marketing - Autumn 2026 Term']);
  assert.deepEqual([...byProgramme.values()], ['Marketing (FT MSc)', 'Marketing (FT MBA)']);

  // Same programme and lecture, different terms.
  const byTerm = shortNames(['FT MSc - Marketing - Autumn 2026 Term', 'FT MSc - Marketing - Spring 2027 Term']);
  assert.deepEqual([...byTerm.values()], ['Marketing (FT MSc, Autumn 2026 Term)', 'Marketing (FT MSc, Spring 2027 Term)']);

  // A short name may not equal another course's own (unshortened) name.
  const vsPlain = shortNames(['FT MSc - Marketing - Autumn 2026 Term', 'Marketing']);
  assert.deepEqual([...vsPlain.values()], ['Marketing (FT MSc)', 'Marketing']);

  // Case-insensitive, and every result is unique.
  const mixed = shortNames(['FT MSc - marketing - Autumn 2026 Term', 'FT MSc - Marketing - Autumn 2026 Term (Lecture C)', STORY, AI, CAPS]);
  const values = [...mixed.values()].map((v) => v.toLowerCase());
  assert.equal(new Set(values).size, values.length);
});

test('display settings: defaults, validation, at least one section shown', () => {
  assert.deepEqual(displayOf(undefined), DISPLAY_DEFAULTS);
  assert.deepEqual(displayOf({ hidden: ['nope'] }), DISPLAY_DEFAULTS);
  assert.deepEqual(checkDisplay({ hidden: ['grades', 'grades', 'files'], courseNames: 'short' }), { hidden: ['grades', 'files'], courseNames: 'short', theme: 'system', collapsed: {}, pastOpen: [] });
  assert.deepEqual(checkDisplay({}), { hidden: [], courseNames: 'full', theme: 'system', collapsed: {}, pastOpen: [] });
  const allButOne = SECTIONS.slice(1).map((s) => s.id);
  assert.deepEqual(checkDisplay({ hidden: allButOne }).hidden, allButOne);
  const fails = (d, re) => assert.throws(() => checkDisplay(d), (e) => e.status === 400 && re.test(e.message));
  fails({ hidden: SECTIONS.map((s) => s.id) }, /至少要显示一个区域/);
  fails({ hidden: ['secret'] }, /不认识的区域/);
  fails({ hidden: 'grades' }, /不认识的区域/);
  fails({ courseNames: 'tiny' }, /完整.*简短/);
  fails(null, /格式不对/);
});

test('display settings: the theme', () => {
  assert.equal(DISPLAY_DEFAULTS.theme, 'system', '跟随电脑 by default');
  for (const theme of THEMES) assert.equal(checkDisplay({ theme }).theme, theme);
  assert.deepEqual(THEMES, ['system', 'light', 'dark', 'eye']);
  for (const theme of ['night', '', 'Dark', 1]) {
    assert.throws(() => checkDisplay({ theme }), (e) => e.status === 400 && /跟随电脑.*护眼/.test(e.message), String(theme));
  }
  // Settings saved by an older version have no theme: they follow the computer.
  assert.equal(displayOf({ hidden: ['grades'], courseNames: 'short' }).theme, 'system');
  // An unknown saved theme falls back to all the defaults rather than breaking the page.
  assert.deepEqual(displayOf({ theme: 'neon' }), DISPLAY_DEFAULTS);
});

test('sections: the three main ones first, side by side', () => {
  assert.deepEqual(SECTIONS.map((s) => s.id), ['deadlines', 'files', 'alerts', 'checklist', 'messages', 'announcements', 'grades']);
  assert.deepEqual(SECTIONS.filter((s) => s.top).map((s) => s.id), ['deadlines', 'files', 'alerts']);
  assert.deepEqual(SECTIONS.filter((s) => s.perCourse).map((s) => s.id), ['files', 'messages', 'grades']);
  // Signed out, the checklist is still there.
  assert.ok(SECTIONS.find((s) => s.id === 'checklist').keepSignedOut);
});

test('sections: the page has them in the same order as SECTIONS', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/<section id="([^"]+)" class="card section/g)].map((m) => m[1]);
  assert.deepEqual(ids, SECTIONS.map((s) => s.id));
});

test('sections: open by default, and the student\'s own choice wins', () => {
  const d = DISPLAY_DEFAULTS;
  const open = (opts) => SECTIONS.filter((s) => isOpen(d, s.id, opts)).map((s) => s.id);
  // Phone alerts stay open to guide the setup until they are on.
  assert.deepEqual(open({ alertsOn: false }), ['deadlines', 'files', 'alerts']);
  assert.deepEqual(open({ alertsOn: true }), ['deadlines', 'files']);
  const mine = { ...d, collapsed: { deadlines: true, grades: false, alerts: false } };
  assert.equal(isOpen(mine, 'deadlines'), false);
  assert.equal(isOpen(mine, 'grades'), true);
  assert.equal(isOpen(mine, 'alerts', { alertsOn: true }), true, 'opened by hand stays open');
  assert.equal(isOpen(mine, 'files'), true, 'not touched: the default');
});

test('display settings: folds and 往期课程 are checked and kept', () => {
  const saved = checkDisplay({ collapsed: { grades: false, deadlines: true }, pastOpen: ['files', 'files', 'grades'] });
  assert.deepEqual(saved.collapsed, { grades: false, deadlines: true });
  assert.deepEqual(saved.pastOpen, ['files', 'grades']);
  const fails = (d, re) => assert.throws(() => checkDisplay(d), (e) => e.status === 400 && re.test(e.message));
  fails({ collapsed: { secret: true } }, /展开收起/);
  fails({ collapsed: { grades: 'yes' } }, /展开收起/);
  fails({ collapsed: ['grades'] }, /展开收起/);
  fails({ pastOpen: ['deadlines'] }, /往期课程/, 'deadlines is not listed by course');
  fails({ pastOpen: 'files' }, /往期课程/);
  // Older settings without these fields get the defaults: everything folded as new.
  assert.deepEqual(displayOf({ hidden: [], courseNames: 'full', theme: 'dark' }).collapsed, {});
  assert.deepEqual(displayOf({ theme: 'dark' }).pastOpen, []);
  // 恢复默认 sends the defaults: 往期课程 folded again.
  assert.deepEqual(checkDisplay({ ...DISPLAY_DEFAULTS }).pastOpen, []);
});
