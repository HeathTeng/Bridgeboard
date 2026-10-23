import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alertsSummary, announcementsSummary, checklistSummary, deadlinesSummary, filesSummary, firstWords, gradesSummary, messagesSummary,
  todayChips,
} from '../lib/section-summary.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const H = 60 * 60 * 1000;
const at = (hours) => new Date(NOW + hours * H).toISOString();

test('deadlines: overdue, due soon and the nearest one', () => {
  const rows = [
    { title: 'Quiz 3', due: at(-48), status: 'overdue' },
    { title: 'Draft', due: at(6), status: 'dueSoon' },
    { title: 'Report', due: at(24 * 9), status: 'open' },
    { title: 'Journal', due: at(-120), submitted: true, status: 'done' },
  ];
  assert.equal(deadlinesSummary(rows, NOW), '1 项逾期 · 1 项临期 · 最近一项还剩 6 小时');
  assert.equal(deadlinesSummary(rows.slice(2), NOW), '最近一项还剩 9 天');
  assert.equal(deadlinesSummary([rows[3]], NOW), '最近没有要交的作业');
  assert.equal(deadlinesSummary([], NOW), '最近没有要交的作业');
});

test('checklist, announcements, grades, files, alerts', () => {
  assert.equal(checklistSummary(3, 5), '还有 3 件没做');
  assert.equal(checklistSummary(0, 0), '清单是空的，点开添加');
  assert.equal(checklistSummary(0, 4), '都做完了');
  assert.equal(announcementsSummary([{ title: 'Class moved to Room 4.2 this Friday' }, { title: 'Brief updated' }]), '最近 2 条 · Class moved to Room 4.2 this F…');
  assert.equal(announcementsSummary([]), '最近没有公告');
  const grades = [
    { items: [{ text: '8/10' }, { text: '等待评分' }] },
    { items: [{ text: '9/10' }] },
    { items: [] },
  ];
  assert.equal(gradesSummary(grades), '2 门课 · 1 项等待评分');
  assert.equal(gradesSummary(grades.slice(1)), '1 门课');
  assert.equal(gradesSummary([]), '还没有成绩');
  assert.equal(filesSummary(4, 'E:\\课程资料'), '4 门课可下载 · 保存到 E:\\课程资料');
  assert.equal(filesSummary(4, ''), '4 门课可下载 · 还没选择保存位置');
  assert.equal(filesSummary(0, undefined), '没有找到课程 · 还没选择保存位置');
  assert.equal(alertsSummary({ enabled: true, provider: 'bark' }), '已打开 · Bark');
  assert.equal(alertsSummary({ enabled: true, provider: 'ntfy' }), '已打开 · ntfy');
  assert.equal(alertsSummary({ enabled: false, provider: 'bark' }), '还没打开 · 3 步就能让作业快到期时手机响');
  assert.equal(alertsSummary(undefined), '还没打开 · 3 步就能让作业快到期时手机响');
});

test('messages: unread count and the newest unread one', () => {
  const threads = [
    { unread: 1, from: 'Dr Ada Lee', time: at(-2), preview: '同学们好： 本周五的课改到 4.2 教室，时间不变。' },
    { unread: 2, from: 'Bo Chen', time: at(-20), preview: '补充一下我的想法' },
    { unread: 0, from: '我', time: at(-1), preview: '谢谢老师' },
  ];
  assert.equal(messagesSummary(threads), '3 条未读 · 最新：Dr Ada Lee「同学们好： 本周五的课改到 …」');
  assert.equal(messagesSummary([threads[2]]), '没有未读消息');
  assert.equal(messagesSummary([]), '没有未读消息');
});

test('first words: cut by characters, spaces folded', () => {
  assert.equal(firstWords('  a\n\nb  c '), 'a b c');
  assert.equal(firstWords('一二三四五', 3), '一二三…');
  assert.equal(firstWords(undefined), '');
});

test('today: up to three calm chips, each pointing at its section', () => {
  const rows = [
    { title: 'Old Quiz', due: at(-120), status: 'overdue' },
    { title: 'Weekly Quiz 3', due: at(-48), status: 'overdue' },
    { title: 'Individual Assignment Draft', due: at(5), status: 'dueSoon' },
    { title: 'Report', due: at(200), status: 'open' },
  ];
  const threads = [{ unread: 1, course: 'Management' }, { unread: 2, course: 'Data Storytelling' }, { unread: 0, course: 'Analytics' }];
  const chips = todayChips({ rows, threads, now: NOW });
  assert.deepEqual(chips, [
    { section: 'deadlines', status: 'overdue', text: '2 项逾期 · Weekly Quiz 3 · 已逾期 2 天' },
    { section: 'deadlines', status: 'dueSoon', text: '1 项临期 · Individual Assignment Dr… · 还剩 5 小时' },
    { section: 'messages', status: 'new', text: '3 条未读消息 · Management 等 2 门课' },
  ]);
  for (const c of chips) assert.ok(!/[!！]/.test(c.text), 'no exclamation marks');
  assert.equal(todayChips({ threads: [{ unread: 1, course: 'FT MSc - Marketing - Autumn 2026 Term' }], courseName: () => 'Marketing' })[0].text, '1 条未读消息 · Marketing');
  assert.deepEqual(todayChips({ rows: rows.slice(3), now: NOW }), []);
  assert.deepEqual(todayChips(), []);
});
