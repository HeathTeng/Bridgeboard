import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { alreadyThere, folderParts, isInside, planPaths, targetPath, trimName } from '../lib/downloader.js';
import { loadLibrary } from '../lib/bb.js';

const { safeFileName } = await loadLibrary();
const root = resolve(tmpdir(), 'bb-hub-test-root');

test('splits a content path into the folders that hold the item', () => {
  assert.deepEqual(folderParts('Week 3 / Lecture / Slides'), ['Week 3', 'Lecture']);
  assert.deepEqual(folderParts('Handbook'), []);
  assert.deepEqual(folderParts('.. / Week 1 /  / File'), ['Week 1']);
});

test('builds course / folders / file and removes characters Windows refuses', () => {
  const p = targetPath({ root, course: 'Data: Analytics?', folders: ['Week 3', 'Lec<1>'], fileName: 'notes|v2.pdf' }, safeFileName);
  assert.equal(p, join(root, 'Data_ Analytics_', 'Week 3', 'Lec_1_', 'notes_v2.pdf'));
});

test('.. in any part cannot escape the chosen folder', () => {
  for (const parts of [
    { course: '..', folders: ['..', '..'], fileName: '../../evil.txt' },
    { course: 'C', folders: ['a/../../..'], fileName: '..\\..\\evil.txt' },
    { course: '/etc', folders: ['C:\\Windows'], fileName: 'C:\\Windows\\win.ini' },
  ]) {
    const p = targetPath({ root, ...parts }, safeFileName);
    assert.ok(isInside(root, p), p);
    assert.notEqual(p, root);
  }
  assert.equal(isInside(root, join(root, '..', 'x')), false);
});

test('keeps long paths under the Windows limit and keeps the extension', () => {
  const long = 'Very long folder name '.repeat(10);
  const p = targetPath({ root, course: 'Course '.repeat(20), folders: [long, long, long, long, long], fileName: `${'Lecture '.repeat(40)}.pptx` }, safeFileName);
  assert.ok(p.length <= 240, `${p.length}: ${p}`);
  assert.ok(p.endsWith('.pptx'));
  assert.ok(isInside(root, p));
});

test('trimName keeps the extension when shortening', () => {
  assert.equal(trimName('abcdefghij.pdf', 9), 'abcde.pdf');
  assert.equal(trimName('short.pdf', 50), 'short.pdf');
});

test('skips a file only when the same name and size are already there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-hub-'));
  try {
    const file = join(dir, 'a.pdf');
    assert.equal(alreadyThere(file, 3), false);
    writeFileSync(file, 'abc');
    assert.equal(alreadyThere(file, 3), true);
    assert.equal(alreadyThere(file, 4), false, 'a different size is a new version');
    assert.equal(alreadyThere(file, undefined), true, 'size unknown: the name decides');
    mkdirSync(join(dir, 'folder.pdf'));
    assert.equal(alreadyThere(join(dir, 'folder.pdf'), undefined), false);
    writeFileSync(join(dir, 'a (1).pdf'), 'abcd');
    assert.equal(alreadyThere(file, 4), true, 'an updated version saved as "a (1).pdf" counts');
    assert.equal(alreadyThere(file, 5), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gives same-named files in one folder their own paths', () => {
  const files = [
    { name: 'Notes.pdf', folders: ['Week 1'] },
    { name: 'notes.pdf', folders: ['Week 1'] },
    { name: 'Notes.pdf', folders: ['Week 2'] },
  ];
  const [a, b, c] = planPaths(root, 'C', files, safeFileName);
  assert.equal(a, join(root, 'C', 'Week 1', 'Notes.pdf'));
  assert.equal(b, join(root, 'C', 'Week 1', 'notes (2).pdf'), 'Windows treats names case-insensitively');
  assert.equal(c, join(root, 'C', 'Week 2', 'Notes.pdf'));
});
