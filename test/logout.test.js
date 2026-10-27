// 退出登录 (v0.3.1): forgets the Blackboard login on this computer and keeps
// everything the student made: checklist, settings, ignored work, downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const app = read('../public/app.js');
const bb = read('../lib/bb.js');
const server = read('../server.js');

test('logout deletes the saved session and the sign-in window\'s profile, nothing else', () => {
  const body = bb.slice(bb.indexOf('export async function signOut()'), bb.indexOf('\n}\n', bb.indexOf('export async function signOut()')));
  assert.match(body, /stopRenewal\?\.\(\);\n\s+await renewing;/, 'a silent renewal under way is stopped first');
  assert.match(body, /await logout\(false\);/, 'session.enc only; the encryption key stays');
  assert.match(body, /rmSync\(profileDir\(\), \{ recursive: true, force: true/);
  assert.doesNotMatch(body, /checklist|settings|seen|push-sent|downloadDir/, 'local data stays');
});

test('logout route: refused in demo mode, while signing in and while downloading; caches cleared', () => {
  const route = server.slice(server.indexOf("'/api/logout'"), server.indexOf('const filesRoute'));
  assert.match(route, /req\.method === 'POST'/);
  assert.match(route, /if \(DEMO\) return send\(res, 400/);
  assert.match(route, /connectJob\.state === 'running'\) return send\(res, 409/);
  assert.match(route, /downloadJob\.state === 'running'\) return send\(res, 409/);
  assert.match(route, /await bb\.signOut\(\);\n\s+cache = undefined;\n\s+messagesCache = undefined;\n\s+fileCache\.clear\(\);/);
});

test('page: 退出登录 only when signed in, asks first, then back to 连接 Blackboard', () => {
  assert.match(html, /<button id="logoutBtn" type="button" hidden>退出登录<\/button>/);
  assert.match(app, /const LOGOUT_CONFIRM = '退出后需要重新登录 Blackboard。你的清单和设置会保留。';/);
  assert.match(app, /if \(!window\.confirm\(LOGOUT_CONFIRM\)\) return;/);
  assert.match(app, /connected = true;\n\s+\$\('logoutBtn'\)\.hidden = Boolean\(status\.demo\);/);
  assert.match(app, /function showSignedOut\(\) \{[\s\S]{0,80}\$\('logoutBtn'\)\.hidden = true;/);
  const handler = app.slice(app.indexOf("$('logoutBtn').addEventListener"), app.indexOf("$('doLogin').addEventListener"));
  assert.match(handler, /showSignedOut\(\);[\s\S]*showLogin\(\);/);
});

test('two browsers: the note by 连接 Blackboard and 截止日期, and in the FAQ', () => {
  const NOTE = '「在 Blackboard 打开 ↗」和「打开课程主页 ↗」会在电脑的默认浏览器里打开。如果那个浏览器没登录过 Blackboard，第一次会让你登录一下，登录一次就好。';
  assert.equal(html.split(`<p class="tip muted small bb-browser">${NOTE}</p>`).length - 1, 2);
  const login = html.slice(html.indexOf('<section id="login"'), html.indexOf('</section>', html.indexOf('<section id="login"')));
  const deadlines = html.slice(html.indexOf('<section id="deadlines"'), html.indexOf('</section>', html.indexOf('<section id="deadlines"')));
  assert.ok(login.includes(NOTE) && deadlines.includes(NOTE));
  const faq = read('../docs/FAQ.md');
  assert.ok(faq.includes('### 点「在 Blackboard 打开」后要我重新登录 / 打开的不是我平时用的浏览器'));
  assert.ok(faq.includes('设置 → 应用 → 默认应用'));
});

test('FAQ: first start and the phone alert steps come first in their groups', () => {
  const faq = read('../docs/FAQ.md');
  const firstIn = (group) => faq.slice(faq.indexOf(`## ${group}\n`)).split('\n').find((l) => l.startsWith('### '));
  assert.equal(firstIn('安装和打开'), '### 第一次怎么开始？');
  assert.equal(firstIn('手机提醒'), '### 手机提醒一步步设置（苹果）');
  assert.ok(faq.indexOf('### 手机提醒一步步设置（安卓）') < faq.indexOf('### 在手机上能打开面板吗？'));
  // The most important entry stays the very first question.
  assert.equal(faq.split('\n').find((l) => l.startsWith('### ')), '### 只有电脑开着、黑色窗口（Mac 上是终端窗口）开着才会发提醒');
});
