// A failed read from Blackboard must never look like an empty list (v0.3.1:
// the first read after a restart failed and 截止日期 said 「近期没有截止事项 🎉」).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MESSAGES_OFF, READ_FAILED, RELOAD, hasFailures, listView, partlyFailed, settle } from '../lib/read-state.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../public/app.js');
const fail = (code) => Promise.reject(Object.assign(new Error('x'), { code }));

test('settle: a value, a failure, a quiet answer; sign-in errors are passed on', async () => {
  assert.deepEqual(await settle(Promise.resolve([1])), { ok: true, value: [1] });
  assert.deepEqual(await settle(fail('NETWORK')), { ok: false, quiet: false });
  assert.deepEqual(await settle(fail(undefined)), { ok: false, quiet: false });
  assert.deepEqual(await settle(fail('FORBIDDEN'), MESSAGES_OFF), { ok: false, quiet: true }, 'messages turned off');
  assert.deepEqual(await settle(fail('FORBIDDEN')), { ok: false, quiet: false }, 'only quiet where asked');
  for (const code of ['NOT_AUTHENTICATED', 'SESSION_EXPIRED']) await assert.rejects(settle(fail(code)), { code });
});

test('a failed read and a truly empty one show different things', () => {
  assert.equal(listView({ failed: true, count: 0 }), 'failed');
  assert.equal(listView({ failed: false, count: 0 }), 'empty');
  assert.equal(listView({ failed: true, count: 3 }), 'list', 'partly failed: the list, with a note');
  assert.equal(listView({ failed: false, count: 3 }), 'list');
  assert.equal(READ_FAILED, '这次没读到 Blackboard 的数据，点「重新读取」再试一次。');
  assert.equal(RELOAD, '重新读取');
  assert.equal(partlyFailed(2), '有 2 门课这次没读到 Blackboard 的数据，点「重新读取」再试一次。');
});

test('failed reads are not cached, so 重新读取 asks Blackboard again', () => {
  assert.equal(hasFailures({ failed: { todo: false, announcements: 0, grades: 0 } }), false);
  assert.equal(hasFailures({ failed: { todo: true } }), true);
  assert.equal(hasFailures({ failed: { grades: 2 } }), true);
  assert.equal(hasFailures({}), false);
  const server = read('../server.js');
  assert.match(server, /cache = hasFailures\(data\) \? undefined : \{ at: Date\.now\(\), data \};/);
  assert.match(server, /if \(failed\?\.todo\) return send\(res, 503,/, 'no empty calendar either');
});

test('overview and messages mark failures instead of swallowing them', () => {
  const bb = read('../lib/bb.js');
  const overview = bb.slice(bb.indexOf('export async function overview'), bb.indexOf('export async function messageThreads'));
  assert.doesNotMatch(overview, /\.catch\(\(\) => \[\]\)/, 'no failure becomes an empty list');
  assert.match(overview, /settle\(c\.listTodo\(/);
  assert.match(overview, /failed: \{\n\s+todo: !todoRead\.ok,\n\s+announcements: annReads\.filter\(\(r\) => !r\.ok\)\.length,\n\s+grades: gradeReads\.filter\(\(r\) => !r\.ok\)\.length,/);
  assert.match(overview, /failed: !gradeReads\[i\]\.ok,/);
  const messages = bb.slice(bb.indexOf('export async function messageThreads'));
  assert.match(messages, /settle\(c\.listConversations\(x\.courseId, \{ limit: 100 \}\), MESSAGES_OFF\)/);
  assert.match(messages, /failed: reads\.filter\(\(r\) => !r\.ok && !r\.quiet\)\.length,/);
  // Messages count failed courses in a number, which the cache check also sees.
  assert.equal(hasFailures({ failed: 1 }), true);
  assert.equal(hasFailures({ failed: 0 }), false);
});

test('page: every Blackboard section shows the alert and 重新读取 when its read failed', () => {
  assert.match(app, /const line = actionLine\(text, \[\{ label: RELOAD, onClick: reloadNow \}\], 'alert small read-failed'\);/);
  // 截止日期, 作业清单, then 公告, 成绩, 课程消息.
  assert.match(app, /if \(listView\(\{ failed: readFailed\.todo, count: todo\.length \}\) === 'failed'\) \{\n\s+flagError\('deadlines'\);\n\s+return box\.append\(reloadLine\(READ_FAILED\)\);/);
  assert.match(app, /if \(readFailed\.todo && !todoItems\.length\) return box\.replaceChildren\(reloadLine\(READ_FAILED\)\);/);
  assert.equal((app.match(/if \(view === 'failed'\) return box\.(append|replaceChildren)\(reloadLine\(READ_FAILED\)\);/g) ?? []).length, 3);
  assert.equal((app.match(/reloadLine\(partlyFailed\(failed\)\)/g) ?? []).length, 3);
  // 今天要注意 does not say there is nothing to do.
  assert.match(app, /readFailed\.todo \? '这次没读到截止日期，看下面「截止日期」里的提示。' : NOTHING_TODAY/);
});

test('page: 重新读取 is grey while reading, so it cannot send the same requests twice', () => {
  assert.match(app, /button\.disabled = reloading;/, 'a line drawn during the reload starts grey');
  assert.match(app, /async function reloadNow\(\) \{\n\s+if \(reloading\) return;\n\s+setReloading\(true\);\n\s+try \{\n\s+await load\(true\);\n\s+\} finally \{\n\s+setReloading\(false\);/);
  assert.match(app, /for \(const b of document\.querySelectorAll\('\.reload-btn'\)\) b\.disabled = on;/);
});
