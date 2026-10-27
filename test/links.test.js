// The colour legend and the groups in one order, and the small ↗ on every
// link that opens Blackboard (pretend links in demo mode only say what they
// would open).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUSES } from '../lib/status.js';
import { demoMessages, demoOverview } from '../lib/demo.js';
import { shapeThreads } from '../lib/messages.js';
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

test('links to Blackboard: one capsule button, with words that say where it goes', () => {
  assert.match(app, /const BB_BUTTON = \{ item: '在 Blackboard 打开', course: '打开课程主页' \};/);
  assert.match(app, /function bbButton\(href, kind, what\) \{\n  if \(!\/\^https:\\\/\\\/\/\.test\(href \?\? ''\)\) return null;/, 'no school https address: no button');
  // Words and the arrow are text nodes; the screen reader hears the words and 新标签页.
  assert.match(app, /class: 'button bb-btn bb-link'[^\n]*\n\s+words, el\('span', \{ class: 'bb-arrow', 'aria-hidden': 'true' \}, '\\u00a0↗'\), el\('span', \{ class: 'sr-only' \}, '（新标签页）'\)\);/);
  assert.doesNotMatch(app, /innerHTML/, 'built from DOM nodes and text only');
  // Every new-tab link in the page code goes through it.
  assert.equal((app.match(/target: '_blank'/g) ?? []).length, 1, 'only inside bbButton');
  assert.doesNotMatch(app, /bbLink|bbArrow/, 'the old ↗ helpers are gone');
  // Where it goes: 截止日期 and 已忽略 (twice), 作业清单, 课程消息 (row and opened thread), 公告, 成绩, 课程文件.
  assert.equal((app.match(/bbButton\(t\.link, t\.linkKind, '这个作业'\)/g) ?? []).length, 3);
  assert.equal((app.match(/bbButton\(t\.link, t\.linkKind, '这段对话'\)/g) ?? []).length, 2);
  for (const call of ["bbButton(a.link, 'course')", "bbButton(c.link, 'course')", "bbButton(course.link, 'course')"]) assert.ok(app.includes(call), call);
  // Titles are plain words now; only the button opens Blackboard.
  assert.doesNotMatch(app, /class: 'title' \}, \/\^https/);
  const css = read('../public/style.css');
  assert.match(css, /\.bb-btn \{[^}]*white-space: nowrap;[^}]*color: var\(--accent\);/);
  assert.match(css, /\.sr-only \{/);
});

test('button words: the item itself only for assignments and message threads, else the course home', () => {
  assert.equal(linkKind({ contentId: '_5_1', assessment: true }), 'item');
  assert.equal(linkKind({ contentId: '_5_1', assessment: false }), 'course', 'Turnitin and the like');
  assert.equal(linkKind({ threadId: '_9_1' }), 'item');
  assert.equal(linkKind({}), 'course');
  const bb = read('../lib/bb.js');
  assert.match(bb, /linkKind: linkKind\(\{ contentId, assessment: info\.assessment \}\),/, '截止日期');
  assert.equal((bb.match(/linkKind: 'course',/g) ?? []).length, 2, '公告 and 成绩: the course home');
  assert.match(bb, /courses: courses\.map\(\(x\) => \(\{ \.\.\.x, link: courseLink\(base, x\.id\), linkKind: 'course' \}\)\),/, '课程文件');
  const o = demoOverview();
  assert.ok(o.todo.some((t) => t.linkKind === 'item') && o.todo.some((t) => t.linkKind === 'course'), 'demo shows both words');
  for (const x of [...o.announcements, ...o.grades, ...o.courses]) assert.equal(x.linkKind, 'course');
  for (const t of demoMessages().threads) assert.equal(t.linkKind, 'item');
});

test('demo mode: the pretend data has links, and clicking one only says what the real panel would open', () => {
  for (const t of demoOverview().todo) assert.match(t.link, /^https:\/\/demo\.blackboard\.com\/ultra\/courses\/_\d+_\d+\/(outline|assessment\/_\d+_\d+\/overview\?courseId=_\d+_\d+)$/);
  for (const t of demoMessages().threads) assert.match(t.link, /^https:\/\/demo\.blackboard\.com\/ultra\/courses\/_\d+_\d+\/messages\/edit\/[\w-]+\?courseId=_\d+_\d+&offset=0&count=1$/);
  assert.match(app, /const a = settings\.demo && e\.target\.closest\?\.\('a\.bb-link'\);[\s\S]{0,80}e\.preventDefault\(\);\s*toast\(`示例模式不会打开 Blackboard，正式版会打开\$\{a\.dataset\.what\}`\);/);
  assert.match(html, /<div id="demoNote" class="undo-bar" role="status" hidden><\/div>/);
  // So the line reads 「示例模式不会打开 Blackboard，正式版会打开这个作业」, or 这门课的主页 for the course home.
  assert.match(app, /'data-what': kind === 'item' \? what : '这门课的主页'/);
});

// ---- 课程消息, 公告, 成绩: links to the school's https address only ----

import { blackboardLink, courseLink, linkKind, messagesLink } from '../lib/links.js';

const SCHOOL = 'https://school.blackboard.com';

test('course and message links: the school\'s https address, never anything else', () => {
  assert.equal(courseLink(SCHOOL, '_12_1'), 'https://school.blackboard.com/ultra/courses/_12_1/outline');
  assert.equal(messagesLink(SCHOOL, '_12_1', '_9_1'), 'https://school.blackboard.com/ultra/courses/_12_1/messages/edit/_9_1?courseId=_12_1&offset=0&count=1');
  assert.equal(messagesLink(SCHOOL, '_12_1'), 'https://school.blackboard.com/ultra/courses/_12_1/outline', 'no thread: course home');
  assert.equal(messagesLink(SCHOOL, '_12_1', '//evil.example.com'), 'https://school.blackboard.com/ultra/courses/_12_1/messages/edit/%2F%2Fevil.example.com?courseId=_12_1&offset=0&count=1');
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

// Copied from the address bar of a real Ultra site (2026-10-27), opened from inside Blackboard.
// The old guesses (…/outline/assessment/…, …/messages) showed 「我们无法找到该页面」.
test('link formats match the real Ultra addresses', () => {
  const real = 'https://psbacademyedu.blackboard.com';
  assert.equal(courseLink(real, '_21109_1'), `${real}/ultra/courses/_21109_1/outline`);
  assert.equal(blackboardLink(real, { courseId: '_21109_1', contentId: '_1703918_1', assessment: true }),
    `${real}/ultra/courses/_21109_1/assessment/_1703918_1/overview?courseId=_21109_1`);
  assert.equal(messagesLink(real, '_21109_1', '_120714_1'),
    `${real}/ultra/courses/_21109_1/messages/edit/_120714_1?courseId=_21109_1&offset=0&count=1`);
  // Anything else falls back to the course home, which is known to open.
  assert.equal(blackboardLink(real, { courseId: '_21109_1', contentId: '_5_1' }), courseLink(real, '_21109_1'));
  const links = read('../lib/links.js');
  assert.doesNotMatch(links, /\/outline\/assessment\//);
  assert.doesNotMatch(links, /\/messages`/);
});

test('each message thread links to that thread', () => {
  const { threads } = shapeThreads([{ courseId: '_21109_1', course: 'A', threads: [{ id: '_120714_1', messages: [] }] }],
    { selfId: 'me', toText: (h) => h, baseUrl: SCHOOL });
  assert.equal(threads[0].link, `${SCHOOL}/ultra/courses/_21109_1/messages/edit/_120714_1?courseId=_21109_1&offset=0&count=1`);
});

test('the overview gives 公告 and 成绩 their course link; demo data has pretend ones', () => {
  const bb = read('../lib/bb.js');
  assert.match(bb, /courseId: a\.courseId,\n\s+link: courseLink\(base, a\.courseId\),/, '公告');
  assert.match(bb, /course: x\.name,\n\s+link: courseLink\(base, x\.id\),/, '成绩');
  const o = demoOverview();
  for (const a of o.announcements) assert.equal(a.link, `https://demo.blackboard.com/ultra/courses/${a.courseId}/outline`);
  for (const g of o.grades) assert.equal(g.link, `https://demo.blackboard.com/ultra/courses/${g.courseId}/outline`);
});

test('page: 公告, 成绩 and each 课程消息 row carry a button; at phone width it goes under the words', () => {
  assert.match(app, /el\('summary', \{\}, el\('span', \{ class: 'title' \}, glossed\(a\.title\)\), bbButton\(a\.link, 'course'\)\)/, '公告');
  assert.match(app, /courseEl\(c\.course\),\n\s+bbButton\(c\.link, 'course'\),/, '成绩');
  assert.match(app, /bbButton\(t\.link, t\.linkKind, '这段对话'\),\n\s+el\('span', \{ class: 'chev' \}\)/, '课程消息: next to the fold arrow');
  const css = read('../public/style.css');
  const phone = css.slice(css.lastIndexOf('@media (max-width: 600px) {'));
  assert.match(phone, /summary \.bb-btn \{ display: flex; width: fit-content;/);
  assert.match(phone, /\.msg-top::after, \.grade-course > summary::after \{ content: ''; flex-basis: 100%; order: 1; \}/);
  assert.match(phone, /\.dl-row > \.dl-body \{ flex-basis: 100%; \}/, 'deadline buttons go under the title');
  const NOTE = '点开后就是在 Blackboard 里操作了，在那里打开消息会被 Blackboard 标成已读；面板本身不会改动 Blackboard 的任何内容。Blackboard 会在新标签页打开，看完关掉那个标签就回到面板。';
  for (const id of ['announcements', 'grades']) {
    const start = html.indexOf(`<section id="${id}"`);
    const s = html.slice(start, html.indexOf('</section>', start));
    assert.equal(s.split(NOTE).length - 1, 1, `${id}: the note once`);
  }
});

test('deadline rows: in a narrow column the button, capsule and × go under the title, never squeezing it', () => {
  const css = read('../public/style.css');
  assert.match(css, /\n\.dl-row \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\n\.dl-body \{ flex: 1 1 220px; min-width: 0;/);
  // Hovering keeps the button's fill, so its words stay at 4.5:1 (checked in theme.test.js).
  assert.match(css, /\.bb-btn:hover, \.bb-btn:focus-visible \{ border-color: var\(--accent-deco\); text-decoration: underline; \}/);
});
