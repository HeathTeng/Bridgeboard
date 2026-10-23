import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const css = read('../public/style.css');

test('checklist: the last row of 我的清单 is 「＋ 点这里添加一件事」, and the box under it starts hidden', () => {
  const own = html.indexOf('id="clOwn"');
  const add = html.indexOf('id="addRow"');
  const done = html.indexOf('id="clOwnDone"');
  assert.ok(own > 0 && own < add && add < done, 'open items, then the 「＋」 row, then 已完成');
  assert.match(html, /<button id="addOpen" type="button"[^>]*>.*点这里添加一件事<\/button>/);
  assert.match(html, /<form id="addForm"[^>]*\shidden>/);
  // The old always-open form with an 添加 button is gone.
  assert.doesNotMatch(html, /<button type="submit" class="primary">添加<\/button>/);
});

test('phone width: one block at 600 px keeps 16 px sides and puts 不再提示 under the words', () => {
  const start = css.indexOf('@media (max-width: 600px) {\n  body');
  assert.ok(start > 0, 'the phone-width block exists');
  const block = css.slice(start, css.indexOf('\n}\n', start));
  assert.match(block, /body \{ padding: 16px 16px/);
  assert.match(block, /\.keep-open-off \{ position: static;/);
  assert.match(block, /\.cl-side \{ flex-basis: 100%/);
});
