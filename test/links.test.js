// The colour legend and the groups in one order, and the small ↗ on every
// link that opens Blackboard (pretend links in demo mode only say what they
// would open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUSES } from '../lib/status.js';
import { demoMessages, demoOverview } from '../lib/demo.js';
import { GUIDE_PAGES } from '../public/guide.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const app = read('../public/app.js');

test('order: legend, groups, guide capsules and words all go 逾期, 临期, 还有时间, 刚开放, 已完成', () => {
  assert.deepEqual(STATUSES, ['overdue', 'dueSoon', 'open', 'new', 'done'], '进行中 before 今天新开放');
  const legend = html.slice(html.indexOf('<p class="legend small"'), html.indexOf('</p>', html.indexOf('<p class="legend small"')));
  assert.deepEqual([...legend.matchAll(/class="pill st-(\w+)"/g)].map((m) => m[1]), STATUSES);
  const spot = read('../public/spotlight.js');
  assert.deepEqual([...spot.matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]), STATUSES, 'the guide\'s colour capsules');
  const words = GUIDE_PAGES.find((p) => p.id === 'deadlines').lines[0];
  const at = (w) => words.indexOf(w);
  assert.ok(at('逾期') < at('临期') && at('临期') < at('还有时间') && at('还有时间') < at('刚开放') && at('刚开放') < at('已完成'), words);
  const faq = read('../docs/FAQ.md');
  assert.ok(faq.indexOf('**还有时间**') < faq.indexOf('**刚开放**'), 'FAQ lists them the same way');
  assert.match(app, /const ordered = STATUSES\.flatMap/, 'the groups follow STATUSES');
});

test('links to Blackboard: one helper with a small ↗, read out as 在 Blackboard 里打开', () => {
  assert.match(app, /function bbLink\(href, content, \{ what = '这个作业', cls = 'bb-link' \} = \{\}\) \{/);
  assert.match(app, /el\('span', \{ class: 'bb-arrow', 'aria-hidden': 'true' \}, '\\u00a0↗'\), el\('span', \{ class: 'sr-only' \}, ' 在 Blackboard 里打开'\)/);
  // Every new-tab link in the page code goes through it: deadlines, 已忽略, checklist, messages.
  assert.equal((app.match(/target: '_blank'/g) ?? []).length, 1, 'only inside bbLink');
  assert.equal((app.match(/bbLink\(t\.link, glossed\(t\.title\)\)/g) ?? []).length, 3);
  assert.match(app, /bbLink\(t\.link, '在 Blackboard 中打开', \{ what: '这条消息', cls: 'button bb-link' \}\)/);
  const css = read('../public/style.css');
  assert.match(css, /\.bb-arrow \{[^}]*color: var\(--accent\);/);
  assert.match(css, /\.bb-link:not\(\.button\):hover, \.bb-link:not\(\.button\):focus-visible \{ text-decoration: underline; \}/);
  assert.match(css, /\.sr-only \{/);
});

test('demo mode: the pretend data has links, and clicking one only says what the real panel would open', () => {
  for (const t of demoOverview().todo) assert.match(t.link, /^https:\/\/demo\.blackboard\.com\/ultra\/courses\/_\d+_\d+\/outline$/);
  for (const t of demoMessages().threads) assert.match(t.link, /^https:\/\/demo\.blackboard\.com\/ultra\/courses\/_\d+_\d+\/messages$/);
  assert.match(app, /const a = settings\.demo && e\.target\.closest\?\.\('a\.bb-link'\);[\s\S]{0,80}e\.preventDefault\(\);\s*toast\(`示例模式不会打开 Blackboard，正式版会打开\$\{a\.dataset\.what\}`\);/);
  assert.match(html, /<div id="demoNote" class="undo-bar" role="status" hidden><\/div>/);
  // So the line reads 「示例模式不会打开 Blackboard，正式版会打开这个作业」 for an assignment.
  assert.match(app, /what = '这个作业'/);
});

// ---- 课程消息, 公告, 成绩: links to the school's https address only ----

import { blackboardLink, courseLink, messagesLink } from '../lib/links.js';

const SCHOOL = 'https://school.blackboard.com';

test('course and message links: the school\'s https address, never anything else', () => {
  assert.equal(courseLink(SCHOOL, '_12_1'), 'https://school.blackboard.com/ultra/courses/_12_1/outline');
  assert.equal(messagesLink(SCHOOL, '_12_1'), 'https://school.blackboard.com/ultra/courses/_12_1/messages');
  for (const make of [courseLink, messagesLink, (b, id) => blackboardLink(b, { courseId: id })]) {
    assert.equal(make('http://school.blackboard.com', '_12_1'), undefined, 'not https: no link');
    assert.equal(make('not a url', '_12_1'), undefined);
    assert.equal(make(undefined, '_12_1'), undefined, 'no saved school address: no link');
    assert.equal(make(SCHOOL, undefined), undefined, 'no course: no link');
    // A strange course id cannot lead off the school's host.
    const odd = make(SCHOOL, '//evil.example.com/x');
    assert.ok(odd === undefined || new URL(odd).host === 'school.blackboard.com', odd);
  }
});

test('the overview gives 公告 and 成绩 their course link; demo data has pretend ones', () => {
  const bb = read('../lib/bb.js');
  assert.match(bb, /courseId: a\.courseId,\n\s+link: courseLink\(base, a\.courseId\),/, '公告');
  assert.match(bb, /course: x\.name,\n\s+link: courseLink\(base, x\.id\),/, '成绩');
  const o = demoOverview();
  for (const a of o.announcements) assert.equal(a.link, `https://demo.blackboard.com/ultra/courses/${a.courseId}/outline`);
  for (const g of o.grades) assert.equal(g.link, `https://demo.blackboard.com/ultra/courses/${g.courseId}/outline`);
});

test('page: 公告, 成绩 and each 课程消息 row carry a ↗; no https address, no link', () => {
  assert.ok(app.includes("function bbArrow(href, what, label = '') {\n  if (!/^https:\\/\\//.test(href ?? '')) return null;"), 'no school https address: no link');
  assert.match(app, /el\('summary', \{\}, el\('span', \{ class: 'title' \}, glossed\(a\.title\)\), bbArrow\(a\.link, '这门课的页面'\)\)/, '公告');
  assert.match(app, /courseEl\(c\.course\),\n\s+bbArrow\(c\.link, '这门课的页面'\),/, '成绩');
  assert.match(app, /bbArrow\(t\.link, '这门课的消息页', '在 Blackboard 打开'\),\n\s+el\('span', \{ class: 'chev' \}\)/, '课程消息: next to the fold arrow');
  const NOTE = '点开后就是在 Blackboard 里操作了，在那里打开消息会被 Blackboard 标成已读；面板本身不会改动 Blackboard 的任何内容。Blackboard 会在新标签页打开，看完关掉那个标签就回到面板。';
  for (const id of ['announcements', 'grades']) {
    const start = html.indexOf(`<section id="${id}"`);
    const s = html.slice(start, html.indexOf('</section>', start));
    assert.equal(s.split(NOTE).length - 1, 1, `${id}: the note once`);
  }
});
