import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SIGN_IN_STUCK_MS, WRONG_ACCOUNT_CHECK, WRONG_ACCOUNT_CODES, cookiesForHost, cookieHeader, isMicrosoftLogin, onSignInPage, turnOffPersonalSso,
} from '../lib/edge-login.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('wrong account: only Microsoft pages are checked, and the check answers yes or no', () => {
  assert.deepEqual(WRONG_ACCOUNT_CODES, ['AADSTS50020', 'AADSTS50034']);
  assert.equal(isMicrosoftLogin('https://login.microsoftonline.com/common/login'), true);
  assert.equal(isMicrosoftLogin('https://login.live.com/x'), true);
  assert.equal(isMicrosoftLogin('https://school.blackboard.com/ultra'), false);
  assert.equal(isMicrosoftLogin('https://login.microsoftonline.com.evil.example/x'), false);
  assert.equal(isMicrosoftLogin('not a url'), false);
  // The script run in the tab returns only a boolean.
  const run = (body) => new Function('document', `return ${WRONG_ACCOUNT_CHECK};`)({ body });
  assert.equal(run({ textContent: 'Sorry, but we are having trouble signing you in. AADSTS50020: User account from identity provider' }), true);
  assert.equal(run({ textContent: 'AADSTS50034: The user account does not exist' }), true);
  assert.equal(run({ textContent: 'AADSTS500200 something else' }), false, 'whole codes only');
  assert.equal(run({ textContent: 'Pick an account' }), false);
  assert.equal(run(null), false);
  // Nothing from the page is logged or kept: the code that runs it only returns the yes or no.
  const src = read('../lib/edge-login.js');
  const fn = src.slice(src.indexOf('async function showsWrongAccount'), src.indexOf('\n}\n', src.indexOf('async function showsWrongAccount')));
  assert.match(fn, /return result\?\.value === true;/);
  assert.doesNotMatch(fn, /console|writeFile|onStatus|fetch/);
});

test("the sign-in profile has Edge's personal-account single sign-on turned off, before every start", () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-sso-'));
  try {
    turnOffPersonalSso(dir);
    const prefs = () => JSON.parse(readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'));
    assert.equal(prefs().edge.msa_sso_info.allow_for_non_msa_profile, false, 'a new profile');
    // Edge turns it back on while running; the next start sets it again and keeps the rest.
    writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({ keep: 1, edge: { msa_sso_info: { allow_for_non_msa_profile: true, other: 2 } } }));
    turnOffPersonalSso(dir);
    assert.deepEqual(prefs(), { keep: 1, edge: { msa_sso_info: { allow_for_non_msa_profile: false, other: 2 } } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const src = read('../lib/edge-login.js');
  assert.ok(src.indexOf('turnOffPersonalSso(dir);') < src.indexOf('const child = spawn('), 'set before the browser starts');
});

test('page: which account to use while the window is open, and a warning on the wrong one', () => {
  const html = read('../public/index.html');
  const app = read('../public/app.js');
  assert.match(html, /<p id="connectTip" class="tip muted small" hidden>请用学校邮箱登录。如果它自动选了你的个人微软账号，点「使用其他账户」，再输入学校邮箱。<\/p>/);
  assert.match(html, /<p id="connectWrong" class="alert" role="alert" hidden>登录用的不是学校账号。在登录窗口点「使用其他账户」，用学校邮箱重新登录。<\/p>/);
  assert.match(app, /\$\('connectTip'\)\.hidden = false;\n\s+while \(job\.state === 'running'\) \{\n\s+\$\('connectWrong'\)\.hidden = !job\.wrongAccount;/);
  assert.match(app, /\$\('connectTip'\)\.hidden = true;\n\s+\$\('connectWrong'\)\.hidden = true;/, 'both go away when the window closes');
});

test('no real email addresses in code, tests, docs or the FAQ; examples use school.edu', () => {
  const files = ['server.js', 'README.md', 'CLAUDE.md', 'docs/FAQ.md', 'public/index.html', 'public/app.js', 'public/guide.js',
    'lib/edge-login.js', 'lib/bb.js', 'lib/push.js', 'test/edge-login.test.js', 'test/logout.test.js'];
  const allowed = /^(feedback@getboundly\.com|[\w.+-]+@(school\.edu|example\.(com|edu|org)))$/;
  for (const f of files) {
    for (const [address] of read(`../${f}`).matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
      assert.match(address, allowed, `${f}: ${address.replace(/^[^@]+/, '…')}`);
    }
  }
});

test('keeps only cookies a request to the Blackboard host would carry', () => {
  const all = [
    { name: 'BbRouter', value: 'a', domain: 'school.blackboard.com' },
    { name: 'AWSALB', value: 'b', domain: '.blackboard.com' },
    { name: 'ESTSAUTH', value: 'c', domain: 'login.microsoftonline.com' },
    { name: 'x', value: 'd', domain: 'evilblackboard.com' },
  ];
  const mine = cookiesForHost(all, 'school.blackboard.com');
  assert.deepEqual(mine.map((c) => c.name), ['BbRouter', 'AWSALB']);
  assert.equal(cookieHeader(mine), 'BbRouter=a; AWSALB=b');
});

test('silent renewal: which pages mean someone has to sign in', () => {
  const host = 'school.blackboard.com';
  // Blackboard's own login page, with or without the page it meant to open.
  assert.equal(onSignInPage('https://school.blackboard.com/?new_loc=%2Fultra', host), true);
  assert.equal(onSignInPage('https://school.blackboard.com/', host), true);
  assert.equal(onSignInPage('https://school.blackboard.com/webapps/login/', host), true);
  // The school's SSO, off the Blackboard host.
  assert.equal(onSignInPage('https://login.microsoftonline.com/common/oauth2/authorize?x=1', host), true);
  // Signed in, or on the way there.
  assert.equal(onSignInPage('https://school.blackboard.com/ultra/stream', host), false);
  assert.equal(onSignInPage('https://school.blackboard.com/auth-saml/saml/SSO', host), false);
  // A window still starting up.
  assert.equal(onSignInPage('about:blank', host), false);
  assert.equal(onSignInPage('edge://newtab/', host), false);
  assert.equal(onSignInPage('', host), false);
  // Long enough to pass through SSO, much shorter than the old 90-second wait.
  assert.ok(SIGN_IN_STUCK_MS >= 8000 && SIGN_IN_STUCK_MS <= 20000);
});

test('FAQ: the wrong-account error and why the panel opens its own window', () => {
  const faq = read('../docs/FAQ.md');
  assert.ok(faq.includes('### 登录时提示账号不在学校里（AADSTS50020）'));
  assert.ok(faq.includes('**使用其他账户**'));
  assert.ok(faq.includes('### 为什么每次连接都打开一个单独的窗口？'));
});
