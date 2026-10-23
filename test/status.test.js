import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durations, pillText, statusLabel, statusOf, timeLeft } from '../lib/status.js';
import { firstSeen } from '../lib/seen.js';
import { blackboardLink } from '../lib/links.js';

const H = 60 * 60 * 1000;
// Local time, so the "opened today" checks do not depend on the time zone.
const now = new Date(2026, 9, 22, 10, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const later = iso(now + 10 * 24 * H);

test('first match wins: submitted, overdue, due soon, new, open', () => {
  assert.equal(statusOf({ due: iso(now - H), submitted: true }, now), 'done');
  assert.equal(statusOf({ due: iso(now - H) }, now), 'overdue');
  assert.equal(statusOf({ due: iso(now + H), opened: iso(now - H) }, now), 'dueSoon');
  assert.equal(statusOf({ due: later, opened: iso(now - H) }, now), 'new');
  assert.equal(statusOf({ due: later, opened: iso(now - 48 * H) }, now), 'open');
  assert.equal(statusOf({ due: later }, now), 'open');
});

test('due-soon boundary is inclusive and due exactly now is overdue', () => {
  assert.equal(statusOf({ due: iso(now + 12 * H) }, now), 'dueSoon');
  assert.equal(statusOf({ due: iso(now + 12 * H + 1) }, now), 'open');
  assert.equal(statusOf({ due: iso(now) }, now), 'overdue');
});

test('"opened today" goes by the local date', () => {
  const yesterday = new Date(2026, 9, 21, 23, 59).toISOString();
  const today = new Date(2026, 9, 22, 0, 1).toISOString();
  assert.equal(statusOf({ due: later, opened: yesterday }, now), 'open');
  assert.equal(statusOf({ due: later, opened: today }, now), 'new');
  // Not open yet: an opening date in the future is not "new".
  assert.equal(statusOf({ due: later, opened: iso(now + H) }, now), 'open');
});

test('custom durations from the settings', () => {
  const s = { newHours: 24, dueSoonHours: 48 };
  assert.equal(statusOf({ due: iso(now + 40 * H) }, now, s), 'dueSoon');
  assert.equal(statusOf({ due: iso(now + 40 * H) }, now), 'open');
  const lastNight = new Date(2026, 9, 21, 23, 59).toISOString();
  assert.equal(statusOf({ due: later, opened: lastNight }, now, s), 'new');
  assert.equal(statusOf({ due: later, opened: iso(now - 24 * H) }, now, s), 'new');
  assert.equal(statusOf({ due: later, opened: iso(now - 24 * H - 1) }, now, s), 'open');
  assert.equal(statusOf({ due: iso(now + 2 * H) }, now, { dueSoonHours: 1 }), 'open');
});

test('out-of-range durations fall back to the defaults', () => {
  assert.deepEqual(durations({ newHours: 3, dueSoonHours: 100 }), { newHours: 0, dueSoonHours: 12 });
  assert.deepEqual(durations({ newHours: 72, dueSoonHours: 1 }), { newHours: 72, dueSoonHours: 1 });
  assert.deepEqual(durations({ newHours: '6', dueSoonHours: 2.5 }), { newHours: 0, dueSoonHours: 12 });
  assert.equal(statusLabel('dueSoon', { dueSoonHours: 6 }), '6 小时内截止');
  assert.equal(statusLabel('new'), '今天新开放');
  assert.equal(statusLabel('new', { newHours: 48 }), '48 小时内新开放');
});

test('time-left labels', () => {
  assert.equal(timeLeft({ due: iso(now + 3 * 24 * H + 5 * H) }, now), '还剩 3 天');
  assert.equal(timeLeft({ due: iso(now + 24 * H) }, now), '还剩 1 天');
  assert.equal(timeLeft({ due: iso(now + 24 * H - 1) }, now), '还剩 23 小时');
  assert.equal(timeLeft({ due: iso(now + 5 * H + 59 * 60 * 1000) }, now), '还剩 5 小时');
  assert.equal(timeLeft({ due: iso(now + 40 * 60 * 1000) }, now), '还剩 40 分钟');
  assert.equal(timeLeft({ due: iso(now + 30 * 1000) }, now), '还剩不到 1 分钟');
  assert.equal(timeLeft({ due: iso(now - 2 * 24 * H - H) }, now), '已逾期 2 天');
  assert.equal(timeLeft({ due: iso(now) }, now), '刚刚截止');
  assert.equal(timeLeft({ due: iso(now - H), submitted: true }, now), '已提交');
});

test('capsule labels: short, Chinese, one per colour', () => {
  assert.equal(pillText({ due: iso(now - 2 * 24 * H - H) }, 'overdue', now), '逾期 2 天');
  assert.equal(pillText({ due: iso(now - 3 * H) }, 'overdue', now), '逾期 3 小时');
  assert.equal(pillText({ due: iso(now - 30 * 1000) }, 'overdue', now), '刚刚截止');
  assert.equal(pillText({ due: iso(now + 6 * H + 20 * 60 * 1000) }, 'dueSoon', now), '6 小时');
  assert.equal(pillText({ due: iso(now + 40 * 60 * 1000) }, 'dueSoon', now), '40 分钟');
  assert.equal(pillText({ due: iso(now + 30 * 1000) }, 'dueSoon', now), '不到 1 分钟');
  assert.equal(pillText({ due: iso(now + 12 * 24 * H + H) }, 'new', now), '刚开放 · 12 天');
  assert.equal(pillText({ due: iso(now + 9 * 24 * H) }, 'open', now), '9 天');
  assert.equal(pillText({ due: iso(now - H), submitted: true }, 'done', now), '已完成');
  assert.equal(pillText({ due: iso(now + 2 * 24 * H), submitted: true }, 'done', now), '已完成');
});

test('first-seen store: first run counts as not new, later items get a time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-'));
  const file = join(dir, 'seen.json');
  try {
    assert.deepEqual(firstSeen(['a', 'b'], now, file), { a: undefined, b: undefined });
    const next = firstSeen(['a', 'c'], now + H, file);
    assert.equal(next.a, undefined);
    assert.equal(next.c, iso(now + H));
    assert.equal(firstSeen(['c'], now + 5 * H, file).c, iso(now + H));
    // Very old entries are forgotten.
    firstSeen([], now + 200 * 24 * H, file);
    assert.ok(!('c' in JSON.parse(readFileSync(file, 'utf8'))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('links: assessment overview, course outline, https on the school host only', () => {
  const base = 'https://school.blackboard.com';
  assert.equal(
    blackboardLink(base, { courseId: '_12_1', contentId: '_34_1', assessment: true }),
    'https://school.blackboard.com/ultra/courses/_12_1/outline/assessment/_34_1/overview?courseId=_12_1',
  );
  assert.equal(blackboardLink(`${base}/`, { courseId: '_12_1', contentId: '_34_1' }), `${base}/ultra/courses/_12_1/outline`);
  assert.equal(blackboardLink(base, { courseId: '_12_1' }), `${base}/ultra/courses/_12_1/outline`);
  assert.equal(blackboardLink('http://school.blackboard.com', { courseId: '_12_1' }), undefined);
  assert.equal(blackboardLink('not a url', { courseId: '_12_1' }), undefined);
  assert.equal(blackboardLink(base, {}), undefined);
  // Odd ids are escaped instead of changing the path or host.
  const odd = blackboardLink(base, { courseId: '../x?y#z', contentId: '//evil.com', assessment: true });
  assert.ok(odd.startsWith(`${base}/ultra/courses/..%2Fx%3Fy%23z/outline/assessment/%2F%2Fevil.com/`), odd);
});

test('opening date from date-based release rules', async () => {
  const { releaseStart } = await import('../lib/bb.js');
  const rule = (...criteria) => ({ criteria });
  const at = (s) => ({ type: 'DATE', start: s });
  assert.equal(releaseStart({}), undefined);
  assert.equal(releaseStart({ adaptiveReleaseRules: { rules: [rule(at('2026-10-01T00:00:00.000Z'))] } }), '2026-10-01T00:00:00.000Z');
  // Criteria in a rule all apply (latest start); any rule releases (earliest rule).
  assert.equal(releaseStart({ adaptiveReleaseRules: { rules: [
    rule(at('2026-10-01T00:00:00.000Z'), at('2026-10-05T00:00:00.000Z')),
    rule(at('2026-10-03T00:00:00.000Z')),
  ] } }), '2026-10-03T00:00:00.000Z');
  // A rule without a date (e.g. group membership only) leaves it unknown.
  assert.equal(releaseStart({ adaptiveReleaseRules: { rules: [rule(at('2026-10-01T00:00:00.000Z')), rule({ type: 'ACL' })] } }), undefined);
  assert.equal(releaseStart({ adaptiveReleaseRules: { rules: [rule({ ...at('2026-10-01T00:00:00.000Z'), negate: true })] } }), undefined);
});

test('timeline settings are checked before saving', async () => {
  const { checkDurations } = await import('../lib/settings.js');
  assert.deepEqual(checkDurations({ newHours: 0, dueSoonHours: 12 }), { newHours: 0, dueSoonHours: 12 });
  assert.deepEqual(checkDurations({ newHours: 72, dueSoonHours: 72 }), { newHours: 72, dueSoonHours: 72 });
  for (const bad of [{ newHours: 5, dueSoonHours: 12 }, { newHours: 0, dueSoonHours: 0 }, { newHours: 0, dueSoonHours: 73 }, { newHours: '6', dueSoonHours: 12 }, {}]) {
    assert.throws(() => checkDurations(bad), (err) => err.status === 400);
  }
});
