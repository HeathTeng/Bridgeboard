import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../vendor/blackboard-mcp.js';
import { previewOf, shapeMessages, shapeThreads } from '../lib/messages.js';
import { courseOptions, filterThreads, relativeTime } from '../lib/message-view.js';
import { messagesLink } from '../lib/links.js';

const base = 'https://school.blackboard.com';
const opts = { selfId: '_me_1', toText: htmlToText, baseUrl: base };
const person = (id, given, family, preferred) => ({ id, givenName: given, familyName: family, preferredDisplayName: preferred });
const msg = (id, senderId, sender, postDate, html, isRead = true) => ({ id, senderId, sender, postDate, isRead, body: { displayText: html } });

const teacher = person('_t_1', 'Ada', 'Lee', 'Dr Ada Lee');
const classmate = person('_s_1', 'Bo', 'Chen', '');
const me = person('_me_1', 'Me', 'Self', 'Me Self');

const fixture = [
  { courseId: '_10_1', course: 'Management', threads: [
    { id: '_c1_1', includesAllMembers: true, unreadCount: 2, totalCount: 3, updatedDate: '2026-10-21T08:00:00.000Z',
      messages: [msg('_m1', '_t_1', teacher, '2026-10-21T08:00:00.000Z', '<p>Room <b>4.2</b> this Friday.</p><p>Bring &amp; read.</p>', false)] },
    { id: '_c2_1', participantsNotInACategory: [me, classmate], unreadCount: 0, totalCount: 1, updatedDate: '2026-10-19T08:00:00.000Z',
      messages: [msg('_m2', '_me_1', me, '2026-10-19T08:00:00.000Z', '<p>Thanks!</p>')] },
  ] },
  { courseId: '_20_1', course: 'Data Storytelling for Business', threads: [
    { id: '_c3_1', groups: [{ title: 'Group 4' }], unreadCount: 1, totalCount: 5, updatedDate: '2026-10-22T01:00:00.000Z',
      messages: [msg('_m3', '_s_1', classmate, '2026-10-22T01:00:00.000Z', `<p>${'很长的一段话'.repeat(30)}</p><img src="x.png">`, false)] },
  ] },
];

test('threads: newest first, named by audience, unread total, plain-text preview', () => {
  const { threads, unread } = shapeThreads(fixture, opts);
  assert.equal(unread, 3);
  assert.deepEqual(threads.map((t) => t.id), ['_c3_1', '_c1_1', '_c2_1']);
  const [group, all, direct] = threads;
  assert.deepEqual([all.with, group.with, direct.with], ['全班', 'Group 4', 'Bo Chen']);
  assert.deepEqual([all.from, group.from, direct.from], ['Dr Ada Lee', 'Bo Chen', '我']);
  assert.equal(all.preview, 'Room 4.2 this Friday. Bring & read.');
  assert.ok(!/[<>]/.test(all.preview));
  assert.equal([...group.preview].length, 81); // 80 characters and an ellipsis
  assert.ok(group.preview.endsWith('…'));
  assert.equal(all.course, 'Management');
  assert.equal(all.link, `${base}/ultra/courses/_10_1/messages/edit/_c1_1?courseId=_10_1&offset=0&count=1`);
});

test('missing or odd fields do not break a thread', () => {
  const { threads, unread } = shapeThreads([{ courseId: '_1_1', course: 'X', threads: [{ id: '_c_1', unreadCount: 'n/a' }] }], opts);
  assert.equal(unread, 0);
  assert.deepEqual([threads[0].with, threads[0].from, threads[0].preview, threads[0].total], ['（收件人未知）', '', '', 0]);
  assert.equal(previewOf('  a\n\n b  '), 'a b');
  // Only participant ids: count the others.
  const ids = shapeThreads([{ courseId: '_1_1', course: 'X', threads: [{ id: '_c_2', participantIds: ['_me_1', '_a_1', '_b_1'] }] }], opts);
  assert.equal(ids.threads[0].with, '另外 2 人');
});

test('messages in a thread: oldest first, mine marked, media noted, unread kept', () => {
  const rows = shapeMessages([
    msg('_b', '_me_1', me, '2026-10-21T09:00:00.000Z', '<p>Got it</p>'),
    msg('_a', '_t_1', teacher, '2026-10-21T08:00:00.000Z', '<p>See <img src="a.png"> below</p><script>alert(1)</script>', false),
  ], opts);
  assert.deepEqual(rows.map((m) => m.id), ['_a', '_b']);
  assert.deepEqual([rows[0].from, rows[0].unread, rows[0].hasMedia, rows[0].mine], ['Dr Ada Lee', true, true, false]);
  assert.deepEqual([rows[1].from, rows[1].mine, rows[1].hasMedia], ['我', true, false]);
  assert.ok(!rows[0].text.includes('<') && !rows[0].text.includes('alert'), rows[0].text);
});

test('filters and the course dropdown', () => {
  const { threads } = shapeThreads(fixture, opts);
  assert.equal(filterThreads(threads).length, 3);
  assert.deepEqual(filterThreads(threads, { unreadOnly: true }).map((t) => t.id), ['_c3_1', '_c1_1']);
  assert.deepEqual(filterThreads(threads, { courseId: '_10_1' }).map((t) => t.id), ['_c1_1', '_c2_1']);
  assert.deepEqual(filterThreads(threads, { unreadOnly: true, courseId: '_10_1' }).map((t) => t.id), ['_c1_1']);
  assert.deepEqual(courseOptions(threads).map((c) => c.name), ['Data Storytelling for Business', 'Management']);
});

test('relative times in local time', () => {
  const now = new Date(2026, 9, 22, 15, 0).getTime();
  const at = (...a) => new Date(2026, ...a).toISOString();
  assert.equal(relativeTime(at(9, 22, 14, 59, 30), now), '刚刚');
  assert.equal(relativeTime(at(9, 22, 14, 20), now), '40 分钟前');
  assert.equal(relativeTime(at(9, 22, 0, 30), now), '14 小时前');
  assert.equal(relativeTime(at(9, 21, 23, 50), now), '昨天 23:50');
  assert.equal(relativeTime(at(9, 20, 9, 5), now), '10月20日 09:05');
  assert.equal(relativeTime(new Date(2025, 2, 5, 10, 0).toISOString(), now), '2025年3月5日');
  assert.equal(relativeTime(null, now), '');
});

test('messages link: https on the school host only', () => {
  assert.equal(messagesLink(base, '_10_1', '_7_1'), `${base}/ultra/courses/_10_1/messages/edit/_7_1?courseId=_10_1&offset=0&count=1`);
  assert.equal(messagesLink(base, '_10_1'), `${base}/ultra/courses/_10_1/outline`, 'no thread: course home');
  assert.equal(messagesLink('http://school.blackboard.com', '_10_1'), undefined);
  assert.equal(messagesLink(base, ''), undefined);
  assert.ok(messagesLink(base, '../../evil?x').startsWith(`${base}/ultra/courses/..%2F..%2Fevil%3Fx/`));
});
