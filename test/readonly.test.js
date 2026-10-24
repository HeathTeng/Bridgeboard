// 只读 (agreed with the owner): the panel may link to Blackboard, but never
// changes anything there, not even "read". This scans our own code (lib/ and
// server.js; vendor/ is the library and is not changed) for how it uses the
// library and the network.
//
// Note: the library itself reads the to-do list through Blackboard's own
// batch endpoint (an HTTP PUT that carries only GET requests, as the Ultra
// web page does). That is a read; what these tests guard is that our code
// only ever asks the library to read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FILES = [...readdirSync(join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`), 'server.js'];
/** The code without comments, so a note like "never calls markMessageRead" does not count. */
const code = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const ALL = Object.fromEntries(FILES.map((f) => [f, code(f)]));

// The library calls our code makes. Each one only reads (or, for login, checks
// a session against a GET and stores it on this computer). A new call must be
// checked and added here on purpose.
const CLIENT_READS = new Set([
  'courseName', 'getContent', 'listConversationMessages', 'listConversations', 'listCourseAnnouncements', 'listCourses',
  'listGrades', 'listTerms', 'readAttempts', 'selfId', 'sessionSecondsRemaining', 'startSessionKeeper', 'walkContents',
  'whoami', 'listTodo',
]);
const LIBRARY_READS = new Set([
  'BlackboardClient', 'courseLabel', 'htmlToText', 'displayName', 'extractText', 'fileDetailOf', 'linkTargetOf',
  'recogniseExternalDocument', 'externalFileName', 'loadConfigOrNull', 'login', 'normaliseBaseUrl', 'safeFileName',
  'downloadToDisk', 'fetchExternalDocument', 'rawFileUrl', 'setLogLevel',
]);

test('read-only: nothing marks anything as read, reviewed or submitted', () => {
  for (const [file, src] of Object.entries(ALL)) {
    assert.doesNotMatch(src, /mark\w*Read/i, `${file}: no mark…Read (markMessageRead and the like)`);
    // Library calls are checked against the read-only list below; here, the write names by themselves.
    assert.doesNotMatch(src, /markReviewed|submitAttempt|\bsubmit[A-Z]\w*\(|\bpost(Attempt|Reply|Message)\w*\(/, `${file}: no submit / post calls`);
  }
});

test('read-only: writes are never switched on', () => {
  for (const [file, src] of Object.entries(ALL)) {
    assert.doesNotMatch(src, /BLACKBOARD_MCP_ALLOW_WRITES/, `${file}: no BLACKBOARD_MCP_ALLOW_WRITES`);
    assert.doesNotMatch(src, /forceAllowWrite/, `${file}: no forceAllowWrite`);
  }
  for (const f of ['start.bat', 'demo.bat']) assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /ALLOW_WRITES/, f);
});

test('read-only: our code calls only reading library functions', () => {
  const bb = ALL['lib/bb.js'];
  const client = new Set([...bb.matchAll(/\bc\.(\w+)\(/g)].map((m) => m[1]));
  for (const name of client) assert.ok(CLIENT_READS.has(name), `client call c.${name}() is not on the read-only list`);
  assert.doesNotMatch(bb, /\bc\.http\.(request|json)\(/, 'no raw requests through the client');
  const used = new Set();
  for (const src of Object.values(ALL)) {
    for (const m of src.matchAll(/const \{([^}]+)\} = await (?:bb\.)?loadLibrary\(\)/g)) m[1].split(',').forEach((n) => used.add(n.trim()));
  }
  for (const m of bb.matchAll(/\blib\.(\w+)/g)) used.add(m[1]);
  for (const name of used) assert.ok(LIBRARY_READS.has(name), `library function ${name} is not on the read-only list`);
});

test('read-only: requests that are not GET only go to Bark / ntfy (phone alerts), never to Blackboard', () => {
  const nonGet = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/;
  const sending = Object.entries(ALL).filter(([, src]) => nonGet.test(src)).map(([f]) => f);
  assert.deepEqual(sending, ['lib/push.js'], 'only the phone alert sender posts');
  const push = ALL['lib/push.js'];
  assert.match(push, /export const BARK_SERVER = 'https:\/\/api\.day\.app';/);
  assert.match(push, /export const NTFY_SERVER = 'https:\/\/ntfy\.sh';/);
  assert.doesNotMatch(push, /from '\.\/bb\.js'|loadLibrary|BlackboardClient/, 'the sender has no Blackboard session');
  // Our own fetch calls: the phone alert sender, and the server asking itself on 127.0.0.1 whether it already runs.
  const fetching = Object.entries(ALL).filter(([, src]) => /\bfetch\(/.test(src)).map(([f]) => f);
  assert.deepEqual(fetching, ['server.js']);
  assert.deepEqual([...ALL['server.js'].matchAll(/\bfetch\(([^,]+),/g)].map((m) => m[1]), ['`${link}/api/ping`']);
  assert.match(ALL['server.js'], /const link = `http:\/\/localhost:\$\{PORT\}`;/);
});

test('read-only: the page says what opening Blackboard means, once per section, and the FAQ too', () => {
  const NOTE = '点开后就是在 Blackboard 里操作了，在那里打开消息会被 Blackboard 标成已读；面板本身不会改动 Blackboard 的任何内容。Blackboard 会在新标签页打开，看完关掉那个标签就回到面板。';
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const section = (id) => html.slice(html.indexOf(`<section id="${id}"`), html.indexOf('</section>', html.indexOf(`<section id="${id}"`)));
  for (const id of ['deadlines', 'messages']) {
    const s = section(id);
    assert.equal(s.split(NOTE).length - 1, 1, `${id}: once`);
    assert.match(s, new RegExp(`<p class="tip muted small bb-note">${NOTE}</p>`), `${id}: the usual tip box`);
  }
  const faq = readFileSync(join(ROOT, 'docs/FAQ.md'), 'utf8');
  assert.ok(faq.includes(NOTE), 'FAQ: 点开 Blackboard 的链接会怎样？');
  const safe = faq.slice(faq.indexOf('### 我的数据安全吗？'), faq.indexOf('\n## ', faq.indexOf('### 我的数据安全吗？')));
  assert.match(safe, /连「已读」都不会替你标/);
  assert.match(safe, /新标签页/);
});
