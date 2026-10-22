import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistStore, LIMITS } from '../lib/checklist.js';
import { assignmentRows, sortRows } from '../lib/checklist-rows.js';

const H = 60 * 60 * 1000;
const DAY = 24 * H;
const now = Date.parse('2026-10-22T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'checklist-'));
  try {
    return fn(join(dir, 'checklist.json'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rejects = (fn, status, pattern) => assert.throws(fn, (err) => err.status === status && pattern.test(err.message));

test('add, edit, tick, untick and delete, saved on disk', () => withDir((file) => {
  const store = new ChecklistStore(file);
  const a = store.add({ text: '  复习第 3 章  ' }, now);
  assert.equal(a.text, '复习第 3 章');
  assert.equal(a.due, null);
  const b = store.add({ text: '交小组报告', due: '2026-10-25T08:00:00.000Z' }, now);
  // A fresh store reads the same file: nothing is lost on restart.
  const again = new ChecklistStore(file);
  assert.deepEqual(again.list(now).items.map((x) => x.text), ['复习第 3 章', '交小组报告']);

  assert.equal(again.update(a.id, { text: '复习第 4 章', due: '2026-10-30T12:00:00.000Z' }).text, '复习第 4 章');
  const ticked = again.update(a.id, { done: true }, now + H);
  assert.equal(ticked.done, true);
  assert.equal(ticked.doneAt, iso(now + H));
  const unticked = again.update(a.id, { done: false });
  assert.equal(unticked.doneAt, null);
  assert.equal(again.update(b.id, { due: null }).due, null);

  assert.equal(again.remove(b.id).text, '交小组报告');
  assert.deepEqual(new ChecklistStore(file).list(now).items.map((x) => x.id), [a.id]);
}));

test('clear done: all finished items, or only the listed ones', () => withDir((file) => {
  const store = new ChecklistStore(file);
  const [x, y, z] = ['一', '二', '三'].map((text) => store.add({ text }, now));
  store.update(x.id, { done: true });
  store.update(y.id, { done: true });
  assert.deepEqual(store.clearDone([x.id, z.id]), { removed: 1 });
  assert.deepEqual(store.list().items.map((i) => i.text), ['二', '三']);
  assert.deepEqual(store.clearDone(), { removed: 1 });
  assert.deepEqual(store.list().items.map((i) => i.text), ['三']);
}));

test('limits and bad input are refused in plain Chinese', () => withDir((file) => {
  const store = new ChecklistStore(file);
  rejects(() => store.add({ text: '   ' }), 400, /请先输入内容/);
  rejects(() => store.add({}), 400, /请先输入内容/);
  rejects(() => store.add({ text: 42 }), 400, /请先输入内容/);
  rejects(() => store.add({ text: '字'.repeat(LIMITS.text + 1) }), 400, /最多 200 个字，现在有 201 个字/);
  assert.equal(store.add({ text: '😀'.repeat(LIMITS.text) }).text.length, LIMITS.text * 2); // counted as characters
  rejects(() => store.add({ text: 'x', due: 'next friday' }), 400, /截止时间的格式不对/);
  const item = store.add({ text: 'x' });
  rejects(() => store.update(item.id, { done: 'yes' }), 400, /完成状态/);
  rejects(() => store.update(item.id, { colour: 'red' }), 400, /没有收到要修改的内容/);
  rejects(() => store.update('no-such-id', { done: true }), 404, /找不到这条事项/);
  rejects(() => store.remove('no-such-id'), 404, /找不到这条事项/);
  rejects(() => store.clearDone('all'), 400, /格式不对/);
  rejects(() => store.mark('', true), 400, /记号不对/);
  rejects(() => store.mark('_1_1|_2_1', 'yes'), 400, /完成状态/);
  // Line breaks pasted into the text become spaces.
  assert.equal(store.add({ text: '第一行\n第二行' }).text, '第一行 第二行');
}));

test('at most 500 items', () => withDir((file) => {
  writeFileSync(file, JSON.stringify({ items: Array.from({ length: LIMITS.items }, (_, i) => ({ id: String(i), text: 't', done: false })), marks: {} }));
  rejects(() => new ChecklistStore(file).add({ text: '再加一条' }), 400, /最多 500 条/);
}));

test('writes go through a temp file, and a broken file is kept aside', () => withDir((file, dir) => {
  const store = new ChecklistStore(file);
  store.add({ text: 'a' });
  store.mark('_1_1|_2_1', true, now);
  assert.deepEqual(readdirSync(dir), ['checklist.json']); // no temp file left behind
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).marks['_1_1|_2_1']);

  writeFileSync(file, '{ half written');
  assert.deepEqual(store.list().items, []);
  assert.equal(readdirSync(dir).filter((f) => f.startsWith('checklist.json.broken-')).length, 1);
}));

test('manual marks: set, unset, forgotten after 180 days', () => withDir((file) => {
  const store = new ChecklistStore(file);
  store.mark('k1', true, now);
  store.mark('k2', true, now);
  store.mark('k2', false, now);
  assert.deepEqual(Object.keys(store.list(now).marks), ['k1']);
  assert.deepEqual(Object.keys(store.list(now + 181 * DAY).marks), []);
}));

test('demo mode keeps everything in memory', () => {
  const sample = { items: [{ id: 's1', text: '示例', due: null, done: false, createdAt: iso(now), doneAt: null }], marks: {} };
  const store = new ChecklistStore(null, sample);
  store.add({ text: '新的' });
  store.update('s1', { done: true });
  assert.equal(store.list().items.length, 2);
  assert.equal(sample.items[0].done, false); // the sample itself is untouched
});

test('which assignments appear: opened only, auto and manual done, 14-day drop-off', () => {
  const todo = [
    { key: 'open', due: iso(now + DAY), opened: iso(now - DAY) },
    { key: 'notYet', due: iso(now + 5 * DAY), opened: iso(now + H) },
    { key: 'known', due: iso(now + 2 * DAY) }, // no opening time: already there
    { key: 'submitted', due: iso(now - DAY), submitted: true },
    { key: 'ticked', due: iso(now + 3 * DAY), opened: iso(now - DAY) },
    { key: 'oldDone', due: iso(now - 15 * DAY), submitted: true },
    { key: 'oldTicked', due: iso(now - 15 * DAY) },
    { key: 'oldOverdue', due: iso(now - 15 * DAY) },
    { key: 'recentDone', due: iso(now - 13 * DAY), submitted: true },
  ];
  const marks = { ticked: { at: iso(now) }, oldTicked: { at: iso(now) }, submitted: { at: iso(now) } };
  const rows = assignmentRows(todo, marks, now);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(rows.map((r) => r.key), ['open', 'known', 'submitted', 'ticked', 'oldOverdue', 'recentDone']);
  assert.equal(by.open.done, false);
  assert.deepEqual([by.submitted.done, by.submitted.manual], [true, false]); // Blackboard wins over a manual tick
  assert.deepEqual([by.ticked.done, by.ticked.manual], [true, true]);
  assert.equal(by.oldOverdue.done, false); // not done: stays until it leaves Blackboard's list
});

test('row order: dated first by due time, then undated by when added; done latest first', () => {
  const { open, done } = sortRows([
    { id: 'a', createdAt: '2026-10-01', due: null },
    { id: 'b', createdAt: '2026-10-02', due: '2026-10-30T00:00:00.000Z' },
    { id: 'c', createdAt: '2026-09-01', due: null },
    { id: 'd', createdAt: '2026-10-03', due: '2026-10-25T00:00:00.000Z' },
    { id: 'e', done: true, doneAt: '2026-10-20' },
    { id: 'f', done: true, doneAt: '2026-10-21' },
  ]);
  assert.deepEqual(open.map((r) => r.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(done.map((r) => r.id), ['f', 'e']);
});
