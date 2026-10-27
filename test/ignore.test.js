// 忽略逾期作业: kept on this computer only, left out of 今天要注意, the nav
// count, the folded line and phone alerts; handed-in work is never "ignored".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistStore } from '../lib/checklist.js';
import { IGNORE_HINT, isIgnored, splitIgnored } from '../lib/ignore.js';
import { deadlinesSummary, todayChips } from '../lib/section-summary.js';
import { planAlerts } from '../lib/push-rules.js';
import { statusOf } from '../lib/status.js';
import { GUIDE_PAGES } from '../public/guide.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const at = (h) => new Date(NOW + h * HOUR).toISOString();

function tempStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bb-ignore-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'checklist.json') };
}

// ---- Saving ----

test('ignore and 恢复: saved in checklist.json and read back by a new start', (t) => {
  const { file } = tempStore(t);
  const store = new ChecklistStore(file);
  assert.deepEqual(store.list(NOW).ignored, {});
  assert.deepEqual(store.ignore('_2_1|col9', true, NOW), { key: '_2_1|col9', ignored: true });
  assert.deepEqual(new ChecklistStore(file).list(NOW).ignored, { '_2_1|col9': { at: new Date(NOW).toISOString() } });
  store.ignore('_2_1|col9', false, NOW);
  assert.deepEqual(new ChecklistStore(file).list(NOW).ignored, {}, '恢复 removes it');
  // Ignoring is not a manual tick: the checklist's done marks stay untouched.
  store.ignore('k', true, NOW);
  assert.deepEqual(store.list(NOW).marks, {});
});

test('ignore: an older checklist.json without the field still loads, and bad input is refused', (t) => {
  const { file } = tempStore(t);
  writeFileSync(file, JSON.stringify({ items: [], marks: { a: { at: new Date(NOW).toISOString() } } }));
  const store = new ChecklistStore(file);
  assert.deepEqual(store.list(NOW).ignored, {});
  assert.deepEqual(Object.keys(store.list(NOW).marks), ['a']);
  assert.throws(() => store.ignore('', true), /记号/);
  assert.throws(() => store.ignore('k', 'yes'), /格式/);
});

test('ignore: forgotten after 180 days, like the manual ticks', (t) => {
  const { file } = tempStore(t);
  const store = new ChecklistStore(file);
  store.ignore('old', true, NOW);
  assert.deepEqual(Object.keys(store.list(NOW + 181 * 24 * HOUR).ignored), []);
});

test('ignore in demo mode: in memory only, no file written', (t) => {
  const { dir } = tempStore(t);
  const store = new ChecklistStore(null, { items: [], marks: {}, ignored: {} });
  store.ignore('demo|2', true, NOW);
  assert.ok(store.list(NOW).ignored['demo|2']);
  assert.deepEqual(readdirSync(dir), []);
  assert.match(read('../lib/demo.js'), /ignored: \{\},/);
});

// ---- What counts ----

const todo = [
  { key: 'late', title: 'Weekly Quiz 3', course: 'Management', due: at(-30) },
  { key: 'late2', title: 'Case Study', course: 'Management', due: at(-3) },
  { key: 'handed', title: 'Reflection Journal', course: 'Analytics', due: at(-5), submitted: true },
  { key: 'moved', title: 'Essay', course: 'Analytics', due: at(30) },
  { key: 'soon', title: 'Draft', course: 'Analytics', due: at(4) },
];
const rows = todo.map((x) => ({ ...x, status: statusOf(x, NOW) }));

test('only overdue work that is not handed in counts as ignored', () => {
  const ignored = { late: {}, handed: {}, moved: {} };
  assert.equal(isIgnored(rows[0], ignored), true);
  assert.equal(isIgnored(rows[1], ignored), false, 'not ignored');
  assert.equal(isIgnored(rows[2], ignored), false, 'Blackboard says handed in: shown as done again');
  assert.equal(rows[2].status, 'done');
  assert.equal(isIgnored(rows[3], ignored), false, 'due date moved into the future: back in its group');
  const { shown, ignored: hidden } = splitIgnored(rows, ignored);
  assert.deepEqual(hidden.map((r) => r.key), ['late']);
  assert.deepEqual(shown.map((r) => r.key), ['late2', 'handed', 'moved', 'soon']);
});

test('ignored work leaves 今天要注意, the nav count and the folded line', () => {
  const ignored = { late: {}, late2: {} };
  const { shown } = splitIgnored(rows, ignored);
  // The nav badge counts overdue + due soon from the rows still shown.
  assert.equal(shown.filter((r) => r.status === 'overdue' || r.status === 'dueSoon').length, 1);
  const chips = todayChips({ rows: shown, now: NOW });
  assert.ok(!chips.some((c) => c.status === 'overdue'), 'no overdue chip');
  assert.ok(chips.some((c) => c.status === 'dueSoon'));
  assert.doesNotMatch(deadlinesSummary(shown, NOW), /逾期/);
  // Without ignoring, both are there.
  assert.ok(todayChips({ rows, now: NOW }).some((c) => c.status === 'overdue'));
  assert.match(deadlinesSummary(rows, NOW), /2 项逾期/);
});

test('phone alerts: no overdue alert for ignored work, the others still go', () => {
  const push = { rules: { overdue: true, dueSoon: true, strong: false } };
  const recent = [{ key: 'late2', title: 'Case Study', course: 'Management', due: at(-3), link: 'https://x.blackboard.com/a' }];
  const plain = planAlerts({ todo: recent, now: NOW, push });
  assert.equal(plain.alerts.length, 1, 'overdue within 24 hours: one alert');
  const quiet = planAlerts({ todo: recent, now: NOW, push, ignored: { late2: { at: at(-1) } } });
  assert.equal(quiet.alerts.length, 0, 'ignored: none');
  const other = planAlerts({ todo: [...recent, { key: 'soon', title: 'Draft', course: 'A', due: at(4) }], now: NOW, push, ignored: { late2: {} } });
  assert.equal(other.alerts.length, 1, 'the due-soon alert for something else still goes');
  assert.match(read('../lib/push-service.js'), /planAlerts\(\{[^}]*ignored: this\.ignored\(\) \}\)/);
  assert.match(read('../server.js'), /ignored: \(\) => checklist\.list\(\)\.ignored,/);
});

// ---- The page ----

test('page: the round × says it does not change Blackboard; 已忽略 starts folded, with 恢复', () => {
  assert.equal(IGNORE_HINT, '不再提醒这一项（不会改 Blackboard）');
  const app = read('../public/app.js');
  assert.match(app, /el\('button', \{ type: 'button', class: 'dl-ignore', title: IGNORE_HINT, 'aria-label': `\$\{IGNORE_HINT\}：\$\{t\.title\}` \}, '×'\)/);
  assert.match(app, /key === 'overdue' && t\.key \? ignoreButton\(t\) : null/, 'only on overdue rows');
  assert.match(app, /let ignoredOpen = false;/, '已忽略 starts folded');
  assert.match(app, /`已忽略（\$\{rows\.length\}）`/);
  assert.match(app, /'恢复'/);
  assert.match(app, /text: `已忽略"\$\{short\(t\.title\)\}"`/, 'the 6-second 已忽略 · 撤销 bar');
  assert.match(app, /pendingRemoval = \{ send, undo, done, fail, settle, timer: setTimeout\(\(\) => flushRemoval\(\), 6000\) \};/);
  assert.match(app, /'已忽略'\)/, 'the grey capsule in the checklist');
  const css = read('../public/style.css');
  const rule = /\.dl-row \.dl-ignore \{[^}]*\}/.exec(css)[0];
  assert.match(rule, /border-radius: 50%/, 'round');
  assert.match(rule, /width: 34px; height: 34px/, 'easy to tap');
  assert.doesNotMatch(rule, /--red|--error/, 'calm, not red');
  assert.match(css, /\.pill\.st-ignored \{ background: var\(--tip-bg\); color: var\(--muted\); \}/);
  // Phone width: the capsule and × go under the title, so the words are not squeezed.
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  body'));
  assert.match(phone, /\.dl-row > \.dl-body \{ flex-basis: 100%; \}\n  \.dl-side \{ margin-left: auto; flex-wrap: wrap; justify-content: flex-end; \}/);
  assert.match(read('../server.js'), /\/\^\\\/api\\\/checklist\\\/ignored\\\/\(\[\^\/\]\+\)\$\/\.exec\(pathname\)/);
});

test('guide: the deadlines page says overdue work can be ignored with ×, written once in guide.js', () => {
  const page = GUIDE_PAGES.find((p) => p.id === 'deadlines');
  assert.ok(page.lines.some((l) => l.includes('逾期的可以点 × 忽略')));
  assert.ok(page.lines.length <= 3);
});
