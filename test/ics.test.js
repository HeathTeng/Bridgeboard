import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIcs } from '../lib/ics.js';

test('builds one event per pending deadline, skipping submitted work', () => {
  const ics = toIcs([
    { title: 'Essay, part 1', course: 'Management', due: '2026-10-25T15:59:00.000Z', bucket: 'upcoming' },
    { title: 'Done already', course: 'Management', due: '2026-10-20T15:59:00.000Z', bucket: 'submitted' },
  ]);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(ics, /DTEND:20261025T155900Z/);
  assert.match(ics, /SUMMARY:截止：Essay\\, part 1/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('folds long lines without splitting characters', () => {
  const ics = toIcs([{ title: '很长的标题'.repeat(20), course: 'X', due: '2026-10-25T15:59:00.000Z', bucket: 'upcoming' }]);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 76, line);
  assert.ok(!ics.includes('�'));
});
