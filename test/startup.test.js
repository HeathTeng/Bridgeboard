// Opening the page while Blackboard is slow: automatic retries with growing
// gaps, 再试一次 after a minute, and /api/status never waiting for silent renewal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHASES, STUCK_MS, STUCK_TEXT, isRetryable, retryDelay, untilLoaded } from '../lib/startup.js';
import { quickStatus } from '../lib/session-status.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const flush = () => new Promise((r) => setImmediate(r));

/** A pretend clock: timers only fire when advance() moves time on. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  let timers = [];
  const timer = {
    set(fn, ms) {
      seq += 1;
      timers.push({ id: seq, at: t + ms, fn });
      return seq;
    },
    clear(id) { timers = timers.filter((x) => x.id !== id); },
  };
  return {
    now: () => t,
    timer,
    sleep: (ms) => new Promise((r) => timer.set(r, ms)),
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
      await flush();
    },
  };
}

const timeout = () => Object.assign(new Error('学校服务器回应太慢，正在重试。'), { code: 'TIMEOUT' });

/** Watches a promise without awaiting it, so the test can move the clock meanwhile. */
function track(promise) {
  const out = { done: false };
  promise.then((value) => Object.assign(out, { done: true, value }), (error) => Object.assign(out, { done: true, error }));
  return out;
}

test('a first request that is slow and times out is tried again by itself, and the data then shows', async () => {
  const clock = fakeClock();
  let calls = 0;
  const retries = [];
  let stuck = 0;
  const attempt = async () => {
    calls += 1;
    if (calls === 1) {
      await clock.sleep(20_000); // the page gives up on the first request after 20 seconds
      throw timeout();
    }
    await clock.sleep(1000);
    return { todo: ['作业'] };
  };
  const run = track(untilLoaded(attempt, { ...clock, onRetry: (err, n) => retries.push([err.code, n]), onStuck: () => { stuck += 1; } }));
  await clock.advance(20_000);
  assert.equal(run.done, false, 'still waiting during the 2-second gap');
  assert.deepEqual(retries, [['TIMEOUT', 0]]);
  await clock.advance(3000);
  assert.equal(run.done, true);
  assert.deepEqual(run.value, { todo: ['作业'] });
  assert.equal(calls, 2);
  assert.equal(stuck, 0, 'no 再试一次 when the data arrives within a minute');
});

test('failed requests (server errors, network trouble) are retried with growing gaps until one works', async () => {
  const clock = fakeClock();
  const startedAt = [];
  const attempt = async () => {
    startedAt.push(clock.now());
    if (startedAt.length < 4) throw Object.assign(new Error('出了点问题'), { status: 500 });
    return 'ok';
  };
  const run = track(untilLoaded(attempt, clock));
  await clock.advance(60_000);
  assert.equal(run.value, 'ok');
  assert.deepEqual(startedAt, [0, 2000, 6000, 14_000], 'waits 2, 4, then 8 seconds');
});

test('the gaps grow 2, 4, 8, 16 seconds and then stay at 30', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelay), [2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
});

test('after 60 seconds without data, 再试一次 appears, even while a request is still out', async () => {
  const clock = fakeClock();
  let stuck = 0;
  let calls = 0;
  const attempt = async () => {
    calls += 1;
    await clock.sleep(90_000); // a request that hangs for a minute and a half
    if (calls === 1) throw timeout();
    return 'late data';
  };
  const run = track(untilLoaded(attempt, { ...clock, onStuck: () => { stuck += 1; } }));
  await clock.advance(STUCK_MS - 1);
  assert.equal(stuck, 0);
  await clock.advance(1);
  assert.equal(stuck, 1, 'shown at exactly one minute');
  assert.equal(run.done, false, 'retrying goes on behind the explanation');
  await clock.advance(200_000);
  assert.equal(stuck, 1, 'shown once');
  assert.equal(run.value, 'late data', 'data that arrives later still shows');
});

test('the minute counts from when the page opened, across the sign-in check and the course read', async () => {
  const clock = fakeClock();
  await clock.advance(50_000); // the sign-in check already took 50 seconds
  let stuck = 0;
  track(untilLoaded(() => clock.sleep(30_000).then(() => 'x'), { ...clock, since: 0, onStuck: () => { stuck += 1; } }));
  await clock.advance(9999);
  assert.equal(stuck, 0);
  await clock.advance(1);
  assert.equal(stuck, 1);
});

test('the explanation goes away unshown when the data arrives first', async () => {
  const clock = fakeClock();
  let stuck = 0;
  const run = track(untilLoaded(() => clock.sleep(5000).then(() => 'x'), { ...clock, onStuck: () => { stuck += 1; } }));
  await clock.advance(5000);
  assert.equal(run.value, 'x');
  await clock.advance(120_000);
  assert.equal(stuck, 0);
});

test('sign-in problems, the black window being closed and other 4xx answers are not retried', async () => {
  for (const err of [
    { code: 'SESSION_EXPIRED', status: 401 },
    { code: 'NOT_AUTHENTICATED' },
    { code: 'NOT_CONFIGURED' },
    { code: 'SERVER_DOWN' },
    { status: 404 },
    { status: 400 },
  ]) {
    assert.equal(isRetryable(err), false, JSON.stringify(err));
    const clock = fakeClock();
    let calls = 0;
    const run = track(untilLoaded(async () => { calls += 1; throw err; }, clock));
    await clock.advance(10_000);
    assert.equal(run.error, err);
    assert.equal(calls, 1);
  }
  for (const err of [{ code: 'TIMEOUT' }, { status: 500 }, { status: 502 }, { code: 'NETWORK', status: 500 }, {}]) {
    assert.equal(isRetryable(err), true, JSON.stringify(err));
  }
});

test('retries stop after giveUpMs and the last error comes back', async () => {
  const clock = fakeClock();
  let calls = 0;
  const run = track(untilLoaded(async () => { calls += 1; throw timeout(); }, { ...clock, giveUpMs: 60_000 }));
  await clock.advance(120_000);
  assert.equal(run.error.code, 'TIMEOUT');
  assert.equal(calls, 6, 'tries at 0, 2, 6, 14, 30 and 60 seconds; the next would be past the minute');
});

test('a newer load stops an older one quietly', async () => {
  const clock = fakeClock();
  let stop = false;
  let calls = 0;
  const run = track(untilLoaded(async () => { calls += 1; throw timeout(); }, { ...clock, cancelled: () => stop }));
  await clock.advance(1000);
  stop = true;
  await clock.advance(10_000);
  assert.equal(run.error.code, 'CANCELLED');
  assert.equal(calls, 1);
});

test('the waiting words say what is going on and what to do next', () => {
  assert.match(PHASES.reading, /正在从 Blackboard 读取课程，第一次大约要 20 秒，请稍等/);
  assert.match(PHASES.renewing, /自动重新登录/);
  assert.match(STUCK_TEXT, /网络慢/);
  assert.match(STUCK_TEXT, /重新登录/);
  assert.match(STUCK_TEXT, /再试一次/);
  assert.doesNotMatch(Object.values(PHASES).join('') + STUCK_TEXT, /[!！]/, 'calm wording');
});

// ---- /api/status ----

const expired = () => Object.assign(new Error('Your Blackboard session is no longer valid.'), { code: 'SESSION_EXPIRED' });

test('status: a live session answers signed in, without renewing', async () => {
  let renews = 0;
  const status = quickStatus({ check: async () => ({ name: '示例同学', secondsLeft: 600 }), canRenew: () => true, renew: async () => { renews += 1; return true; } });
  assert.deepEqual(await status(), { signedIn: true, name: '示例同学', secondsLeft: 600 });
  assert.equal(renews, 0);
});

test('status: a lapsed session answers at once with renewing, while the renewal runs in the background', async () => {
  let live = false;
  let finish;
  let checks = 0;
  let resets = 0;
  const status = quickStatus({
    check: async () => {
      checks += 1;
      if (!live) throw expired();
      return { name: '示例同学' };
    },
    canRenew: async () => true,
    renew: () => new Promise((r) => { finish = r; }), // the hidden browser takes its time
    reset: () => { resets += 1; },
  });
  assert.deepEqual(await status(), { signedIn: false, renewing: true, code: 'SESSION_EXPIRED' });
  assert.equal(resets, 1);
  await flush();
  assert.equal(typeof finish, 'function', 'renewal started');
  assert.deepEqual(await status(), { signedIn: false, renewing: true }, 'asking again does not wait either');
  assert.equal(checks, 1, 'and does not bother Blackboard while renewing');
  live = true;
  finish(true);
  await flush();
  assert.deepEqual(await status(), { signedIn: true, name: '示例同学' });
});

test('status: after a failed renewal it says signed out, and does not renew again for a while', async () => {
  let t = 0;
  let renews = 0;
  const status = quickStatus({
    check: async () => { throw expired(); },
    canRenew: async () => true,
    renew: async () => { renews += 1; return false; },
    now: () => t,
    cooldownMs: 5 * 60_000,
  });
  assert.equal((await status()).renewing, true);
  await flush();
  await flush();
  const after = await status();
  assert.equal(after.signedIn, false);
  assert.equal(after.renewing, undefined);
  assert.equal(after.code, 'SESSION_EXPIRED');
  assert.equal(renews, 1);
  t = 5 * 60_000;
  assert.equal((await status()).renewing, true, 'tries again after the pause');
  await flush();
  assert.equal(renews, 2);
});

test('status: no saved school login, or a network error, answers signed out straight away', async () => {
  let renews = 0;
  const renew = async () => { renews += 1; return true; };
  const noProfile = quickStatus({ check: async () => { throw expired(); }, canRenew: async () => false, renew });
  assert.deepEqual(await noProfile(), { signedIn: false, error: 'Your Blackboard session is no longer valid.', code: 'SESSION_EXPIRED' });
  const offline = quickStatus({ check: async () => { throw Object.assign(new Error('timed out'), { code: 'NETWORK' }); }, canRenew: async () => true, renew });
  assert.deepEqual(await offline(), { signedIn: false, error: 'timed out', code: 'NETWORK' });
  assert.equal(renews, 0);
});

// ---- The page wiring ----

test('page: the title card has the small ring and the hidden 1-minute explanation', () => {
  const html = read('../public/index.html');
  assert.match(html, /<p id="who"[^>]*role="status"[^>]*><span id="whoSpin" class="spinner" aria-hidden="true"><\/span><span id="whoText">/);
  assert.match(html, /<div id="stuck" class="stuck" hidden><\/div>/);
  const css = read('../public/style.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.spinner \{ animation: none;/, 'the ring stands still under reduced motion');
});

test('page: sign-in check and course read retry with timeouts; the checklist does not wait for Blackboard', () => {
  const app = read('../public/app.js');
  assert.match(app, /untilLoaded\(\(\) => signInState\(cancelled\), wait\)/);
  assert.match(app, /api\('\/api\/status', \{ timeoutMs: STATUS_TIMEOUT \}\)/);
  assert.match(app, /untilLoaded\(\(\) => api\(`\/api\/overview\$\{refresh \? '\?refresh' : ''\}`, \{ timeoutMs: OVERVIEW_TIMEOUT \}\), wait\)/);
  assert.match(app, /label: '再试一次', onClick: \(\) => load\(true\)/);
  // The checklist starts loading next to load(), not after it.
  assert.match(app, /loadChecklist\(\);\ninitPush\(\);\nload\(\);\s*$/);
  const server = read('../server.js');
  assert.match(server, /'startup\.js'\]\);/, 'served to the page like the other shared rules');
});
