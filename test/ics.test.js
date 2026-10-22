import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIcs } from '../lib/ics.js';

test('builds one event per pending deadline, skipping submitted work', () => {
  const link = 'https://school.blackboard.com/ultra/courses/_1_1/outline/assessment/_2_1/overview?courseId=_1_1';
  const ics = toIcs([
    { title: 'Essay, part 1', course: 'Management', due: '2026-10-25T15:59:00.000Z', link },
    { title: 'Done already', course: 'Management', due: '2026-10-20T15:59:00.000Z', submitted: true },
    { title: 'Bad link', course: 'Management', due: '2026-10-26T15:59:00.000Z', link: 'javascript:alert(1)' },
  ]);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
  assert.equal(ics.match(/^URL:/gm).length, 1);
  assert.ok(ics.replace(/\r\n /g, '').includes(`URL:${link}\r\n`));
  assert.match(ics, /DTEND:20261025T155900Z/);
  assert.match(ics, /SUMMARY:截止：Essay\\, part 1/);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('folds long lines without splitting characters', () => {
  const ics = toIcs([{ title: '很长的标题'.repeat(20), course: 'X', due: '2026-10-25T15:59:00.000Z' }]);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 76, line);
  assert.ok(!ics.includes('�'));
});
