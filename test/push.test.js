import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isQuiet, localTime, planAlerts } from '../lib/push-rules.js';
import {
  BARK_SERVER, applyPatch, buildRequest, checkServer, checkTopic, fingerprint, loadSent, mask, newTopic, parseBark,
  pruneSent, pushOf, pushView, record, saveSent, sendAlert, strongVolumeOf, targetOf,
} from '../lib/push.js';
import { PushService } from '../lib/push-service.js';
import { appDirIn, autostartStatus, launcherText, setAutostart } from '../lib/autostart.js';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-22T04:00:00Z'); // 12:00 in Singapore
const TZ = 'Asia/Singapore';
const item = (key, hoursLeft, extra = {}) => ({
  key, title: `作业${key}`, course: '课程A', due: new Date(NOW + hoursLeft * HOUR).toISOString(), submitted: false,
  link: `https://school.example.com/ultra/${key}`, ...extra,
});
const plan = (todo, opts = {}) => planAlerts({ todo, now: NOW, timeZone: TZ, settings: { dueSoonHours: 12 }, ...opts });
const keysOf = (alerts) => alerts.flatMap((a) => a.records);

// ---- Rules ----

test('turning orange fires once, at the due-soon hours from the timeline', () => {
  assert.equal(plan([item('a', 13)]).alerts.length, 0);
  const { alerts } = plan([item('a', 11)]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 'normal');
  assert.equal(alerts[0].title, '作业快到期：作业a');
  assert.match(alerts[0].body, /课程A/);
  assert.match(alerts[0].body, /还剩 11 小时/);
  assert.equal(alerts[0].url, 'https://school.example.com/ultra/a');
  assert.deepEqual(alerts[0].records, ['a#dueSoon']);
  // Already sent: nothing more.
  assert.equal(plan([item('a', 10)], { sent: { items: { 'a#dueSoon': new Date(NOW).toISOString() } } }).alerts.length, 0);
  // A custom timeline: 24 hours.
  assert.equal(plan([item('a', 20)], { settings: { dueSoonHours: 24 } }).alerts.length, 1);
});

test('strong alert at N hours left, and it also covers turning orange', () => {
  const { alerts } = plan([item('a', 4)]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, 'strong');
  assert.match(alerts[0].title, /^⚠️ 还没交：作业a/);
  assert.deepEqual(alerts[0].records, ['a#strong', 'a#dueSoon']);
  // Strong hours setting.
  assert.equal(plan([item('a', 4)], { push: { rules: { strongHours: 2 } } }).alerts[0].level, 'normal');
  // Once only.
  assert.equal(plan([item('a', 3)], { sent: { items: { 'a#strong': 'x', 'a#dueSoon': 'x' } } }).alerts.length, 0);
  // Due-soon set shorter than strong: no orange alert after the strong one rang.
  const later = plan([item('a', 1.5)], {
    settings: { dueSoonHours: 2 }, push: { rules: { repeat: false } }, sent: { items: { 'a#strong': new Date(NOW).toISOString() } },
  });
  assert.equal(later.alerts.length, 0);
});

test('没交就再提醒: strong again at 2 and 1 hour left, once each, only below N', () => {
  const at = (hoursLeft, sentKeys = []) => plan([item('a', hoursLeft)], {
    sent: { items: Object.fromEntries(sentKeys.map((k) => [k, new Date(NOW).toISOString()])) },
  }).alerts;
  // N = 5 (default): 5 hours, then 2, then 1.
  const first = at(4.5);
  assert.deepEqual(first.map((a) => a.records), [['a#strong', 'a#dueSoon']]);
  assert.match(first[0].title, /^⚠️ 还没交：作业a/);
  assert.equal(at(3, first[0].records).length, 0);
  const two = at(2, first[0].records);
  assert.equal(two.length, 1);
  assert.equal(two[0].level, 'strong');
  assert.match(two[0].title, /^⚠️ 再次提醒，还没交：作业a/);
  assert.match(two[0].body, /还剩 2 小时/);
  assert.deepEqual(two[0].records, ['a#strong', 'a#strong2h', 'a#dueSoon']);
  const sent2 = [...first[0].records, 'a#strong2h'];
  assert.equal(at(1.5, sent2).length, 0);
  const one = at(0.9, sent2);
  assert.deepEqual(one[0].records, ['a#strong', 'a#strong2h', 'a#strong1h', 'a#dueSoon']);
  assert.match(one[0].title, /再次提醒/);
  assert.equal(at(0.5, [...sent2, 'a#strong1h']).length, 0);
  // Handed in after the first alert: no repeats.
  assert.equal(plan([item('a', 1.5, { submitted: true })], { sent: { items: { 'a#strong': 'x' } } }).alerts.length, 0);
});

test('没交就再提醒: switched off, small N, and alerts switched on late', () => {
  const sent = { items: { 'a#strong': 'x', 'a#dueSoon': 'x' } };
  assert.equal(plan([item('a', 1.5)], { sent, push: { rules: { repeat: false } } }).alerts.length, 0);
  // N = 2: only the 1-hour repeat.
  const n2 = { rules: { strongHours: 2 } };
  assert.deepEqual(plan([item('a', 1.8)], { push: n2 }).alerts[0].records, ['a#strong', 'a#dueSoon']);
  assert.deepEqual(plan([item('a', 0.8)], { push: n2, sent }).alerts[0].records, ['a#strong', 'a#strong1h', 'a#dueSoon']);
  // N = 1: no repeats at all.
  assert.equal(plan([item('a', 0.5)], { push: { rules: { strongHours: 1 } }, sent }).alerts.length, 0);
  // Switched on with 1.5 hours left: one strong alert (not marked as a repeat), covering 5 h and 2 h.
  const late = plan([item('a', 1.5)]).alerts;
  assert.equal(late.length, 1);
  assert.match(late[0].title, /^⚠️ 还没交：/);
  assert.deepEqual(late[0].records, ['a#strong', 'a#strong2h', 'a#dueSoon']);
  // Strong alerts off: repeats are off too, turning orange still works.
  assert.deepEqual(keysOf(plan([item('a', 1.5)], { push: { rules: { strong: false } } }).alerts), ['a#dueSoon']);
  // Hidden names.
  assert.equal(plan([item('a', 2)], { sent, push: { hideNames: true } }).alerts[0].title, '⚠️ 有 1 项作业 2 小时后截止');
});

test('switched-off rules do not fire', () => {
  const push = { rules: { dueSoon: false, strong: false, overdue: false } };
  assert.equal(plan([item('a', 4), item('b', 10), item('c', -1)], { push }).alerts.length, 0);
});

test('submitted, undated and keyless items are skipped', () => {
  assert.equal(plan([item('a', 4, { submitted: true }), { ...item('b', 4), due: undefined }, { ...item('c', 4), key: undefined }]).alerts.length, 0);
});

test('overdue fires once, only within 24 hours of the deadline', () => {
  const { alerts } = plan([item('a', -2)]);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /^已逾期：作业a/);
  assert.match(alerts[0].body, /已逾期 2 小时/);
  assert.equal(plan([item('a', -25)]).alerts.length, 0);
  assert.equal(plan([item('a', -2)], { sent: { items: { 'a#overdue': 'x' } } }).alerts.length, 0);
  // Already overdue: no orange or strong alert either.
  assert.deepEqual(keysOf(plan([item('a', -0.5)]).alerts), ['a#overdue']);
});

test('more than three alerts in one check become one, linking to the nearest', () => {
  const todo = [item('d', 11), item('b', 9), item('a', 8), item('c', 10)];
  const { alerts } = plan(todo);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /^4 项作业快到期：作业a、作业b 等$/);
  assert.equal(alerts[0].url, 'https://school.example.com/ultra/a');
  assert.equal(alerts[0].body.split('\n').length, 4);
  assert.deepEqual(new Set(keysOf(alerts)), new Set(['a#dueSoon', 'b#dueSoon', 'c#dueSoon', 'd#dueSoon']));
  // Exactly three stay separate.
  assert.equal(plan(todo.slice(0, 3)).alerts.length, 3);
});

test('strong and normal alerts are combined separately', () => {
  const todo = [item('s1', 1), item('s2', 2), item('s3', 3), item('s4', 4), item('n1', 8)];
  const { alerts } = plan(todo);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].level, 'strong');
  assert.match(alerts[0].title, /^⚠️ 4 项作业快截止了还没交/);
  assert.equal(alerts[1].level, 'normal');
  assert.equal(alerts[1].title, '作业快到期：作业n1');
});

test('long combined lists are cut short', () => {
  const todo = Array.from({ length: 9 }, (_, i) => item(`k${i}`, 6 + i * 0.5));
  const body = plan(todo).alerts[0].body.split('\n');
  assert.equal(body.length, 7);
  assert.equal(body.at(-1), '……另外 3 项');
});

test('hidden names: no title, course or link', () => {
  const push = { hideNames: true };
  const [one] = plan([item('a', 5)], { push }).alerts;
  assert.equal(one.title, '⚠️ 有 1 项作业 5 小时后截止');
  assert.equal(one.url, undefined);
  assert.doesNotMatch(`${one.title}${one.body}`, /作业a|课程A/);
  const [orange] = plan([item('a', 10)], { push }).alerts;
  assert.equal(orange.title, '有 1 项作业 10 小时后截止');
  const [late] = plan([item('a', -1)], { push }).alerts;
  assert.equal(late.title, '有 1 项作业已逾期');
  const [many] = plan([item('a', 8), item('b', 9), item('c', 10), item('d', 11)], { push }).alerts;
  assert.equal(many.title, '4 项作业快到期，最近的 8 小时后截止');
  assert.equal(many.url, undefined);
  assert.doesNotMatch(`${many.title}${many.body}`, /作业[a-d]/);
});

test('quiet hours hold normal alerts, strong ones still go, across midnight', () => {
  const quiet = { on: true, from: '23:00', to: '08:00' };
  const night = Date.parse('2026-10-22T16:30:00Z'); // 00:30 in Singapore
  const push = { quiet, rules: { strongHours: 2 } };
  const todo = [{ ...item('a', 0), due: new Date(night + 11 * HOUR).toISOString() }, { ...item('b', 0), due: new Date(night + 1.5 * HOUR).toISOString() }];
  const r = planAlerts({ todo, now: night, timeZone: TZ, settings: { dueSoonHours: 12 }, push });
  assert.deepEqual(r.alerts.map((a) => a.level), ['strong']);
  assert.equal(r.waiting, 1);
  // 08:00: the held one goes now.
  const morning = Date.parse('2026-10-23T00:00:00Z');
  const sent = { items: { 'b#strong': 'x', 'b#dueSoon': 'x', 'b#overdue': 'x' } };
  const later = planAlerts({ todo, now: morning, timeZone: TZ, settings: { dueSoonHours: 12 }, push, sent });
  assert.deepEqual(keysOf(later.alerts), ['a#dueSoon']);
});

test('isQuiet: same-day and overnight ranges, and the time zone', () => {
  const at = (iso) => Date.parse(iso);
  const overnight = { on: true, from: '23:00', to: '08:00' };
  assert.equal(isQuiet(at('2026-10-22T15:30:00Z'), overnight, TZ), true); // 23:30
  assert.equal(isQuiet(at('2026-10-22T23:59:00Z'), overnight, TZ), true); // 07:59
  assert.equal(isQuiet(at('2026-10-23T00:00:00Z'), overnight, TZ), false); // 08:00
  assert.equal(isQuiet(at('2026-10-22T04:00:00Z'), overnight, TZ), false); // 12:00
  assert.equal(isQuiet(at('2026-10-22T04:00:00Z'), overnight, 'America/New_York'), true); // 00:00 there
  const lunch = { on: true, from: '12:00', to: '13:00' };
  assert.equal(isQuiet(at('2026-10-22T04:30:00Z'), lunch, TZ), true);
  assert.equal(isQuiet(at('2026-10-22T05:00:00Z'), lunch, TZ), false);
  assert.equal(isQuiet(at('2026-10-22T15:30:00Z'), { ...overnight, on: false }, TZ), false);
});

test('alert text shows local time in the given time zone', () => {
  assert.equal(localTime('2026-10-22T06:00:00Z', TZ), '10月22日周四 14:00');
  assert.equal(localTime('2026-10-22T06:00:00Z', 'Europe/London'), '10月22日周四 07:00');
  const [a] = plan([{ ...item('a', 0), due: '2026-10-22T10:00:00Z' }]).alerts;
  assert.match(a.body, /截止：10月22日周四 18:00（还剩 6 小时）/);
});

// ---- Message alerts ----

const thread = (id, time, extra = {}) => ({
  id, courseId: '_1_1', course: '课程A', from: '王老师', time, unread: 1, link: 'https://school.example.com/ultra/courses/_1_1/messages', ...extra,
});
const msgPlan = (threads, sentThreads, extra = {}) => planAlerts({
  todo: [], threads, now: NOW, timeZone: TZ, push: { rules: { messages: true } }, sent: { items: {}, threads: sentThreads }, ...extra,
});

test('message alerts: the first check only remembers, then new messages alert once', () => {
  const t1 = new Date(NOW - HOUR).toISOString();
  const first = msgPlan([thread('a', t1)], undefined);
  assert.equal(first.alerts.length, 0);
  assert.deepEqual(first.threadUpdates, { '_1_1|a': t1 });
  assert.equal(msgPlan([thread('a', t1)], { '_1_1|a': t1 }).alerts.length, 0);
  const t2 = new Date(NOW - 60_000).toISOString();
  const [a] = msgPlan([thread('a', t2)], { '_1_1|a': t1 }).alerts;
  assert.equal(a.title, '新课程消息：王老师');
  assert.equal(a.body, '课程A');
  assert.deepEqual(a.records, [{ thread: '_1_1|a', time: t2 }]);
  // Brand-new thread.
  assert.equal(msgPlan([thread('b', t2)], {}).alerts.length, 1);
});

test('message alerts skip my own, already-read and old messages, and need the switch', () => {
  const t = new Date(NOW - 60_000).toISOString();
  assert.equal(msgPlan([thread('a', t, { from: '我' })], {}).alerts.length, 0);
  assert.equal(msgPlan([thread('a', t, { unread: 0 })], {}).alerts.length, 0);
  const old = new Date(NOW - 30 * HOUR).toISOString();
  const r = msgPlan([thread('a', old)], {});
  assert.equal(r.alerts.length, 0);
  assert.deepEqual(r.threadUpdates, { '_1_1|a': old });
  assert.equal(msgPlan([thread('a', t)], {}, { push: { rules: { messages: false } } }).alerts.length, 0);
});

test('message alerts wait in quiet hours and combine above three', () => {
  const t = new Date(NOW - 60_000).toISOString();
  const quiet = msgPlan([thread('a', t)], {}, { push: { rules: { messages: true }, quiet: { on: true, from: '11:00', to: '13:00' } } });
  assert.equal(quiet.alerts.length, 0);
  assert.equal(quiet.waiting, 1);
  assert.deepEqual(quiet.threadUpdates, {});
  const many = msgPlan(['a', 'b', 'c', 'd'].map((id) => thread(id, t)), {});
  assert.equal(many.alerts.length, 1);
  assert.equal(many.alerts[0].title, '4 条新课程消息');
  assert.doesNotMatch(many.alerts[0].body, /内容/);
});

// ---- Keys, topics, masking ----

test('parseBark accepts the whole link, a link with a sample message, or the key', () => {
  const key = 'AbCdEfGhIjKlMnOpQrStUv';
  assert.deepEqual(parseBark(`https://api.day.app/${key}/`), { server: BARK_SERVER, key });
  assert.deepEqual(parseBark(` https://api.day.app/${key}/这里改成你自己的推送内容 `), { server: BARK_SERVER, key });
  assert.deepEqual(parseBark(`复制的内容：https://api.day.app/${key}/推送内容`), { server: BARK_SERVER, key });
  assert.deepEqual(parseBark(key), { server: BARK_SERVER, key });
  assert.deepEqual(parseBark(`api.day.app/${key}`), { server: BARK_SERVER, key });
  assert.deepEqual(parseBark(`https://bark.example.com/${key}/`), { server: 'https://bark.example.com', key });
  assert.throws(() => parseBark(`http://api.day.app/${key}/`), /https/);
  assert.throws(() => parseBark('https://api.day.app/'), /没找到密钥/);
  assert.throws(() => parseBark(''), /粘贴/);
  assert.throws(() => parseBark('不是链接'), /没认出/);
});

test('checkServer: https only, nothing after the host', () => {
  assert.equal(checkServer('https://ntfy.example.com/'), 'https://ntfy.example.com');
  assert.throws(() => checkServer('http://ntfy.example.com'), /https/);
  assert.throws(() => checkServer('https://ntfy.example.com/topic'), /只填到域名/);
  assert.throws(() => checkServer('https://user:pw@ntfy.example.com'), /只填到域名/);
  assert.throws(() => checkServer('ntfy'), /不对/);
});

test('new topics are long and random; masking keeps the last 4', () => {
  const a = newTopic();
  assert.match(a, /^bb-[a-z]{16}$/);
  assert.notEqual(a, newTopic());
  assert.equal(checkTopic(a), a);
  assert.throws(() => checkTopic('short'), /换一个/);
  assert.equal(mask('AbCdEfGhIjKl1234'), '••••1234');
  assert.equal(mask(''), '');
});

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const testedBark = () => {
  const p = pushOf({ provider: 'bark', bark: { server: BARK_SERVER, key: KEY } });
  p.tested = fingerprint(targetOf(p));
  return p;
};

test('alerts cannot be switched on before a successful test', () => {
  const p = pushOf({ provider: 'bark', bark: { key: KEY } });
  assert.throws(() => applyPatch(p, { enabled: true }), (err) => err.code === 'NOT_TESTED');
  assert.equal(applyPatch(testedBark(), { enabled: true }).enabled, true);
  // A saved file claiming "on" without a matching test stays off.
  assert.equal(pushOf({ enabled: true, bark: { key: KEY }, tested: 'nope' }).enabled, false);
  // Changing phone type switches it off.
  const on = applyPatch(testedBark(), { enabled: true });
  assert.equal(applyPatch(on, { provider: 'ntfy' }).enabled, false);
});

test('switch changes are checked', () => {
  const p = testedBark();
  assert.equal(applyPatch(p, { rules: { strongHours: 24 } }).rules.strongHours, 24);
  assert.throws(() => applyPatch(p, { rules: { strongHours: 25 } }), /1 到 24/);
  assert.throws(() => applyPatch(p, { rules: { strongHours: 0 } }), /1 到 24/);
  assert.equal(p.rules.strongVolume, 10);
  assert.equal(p.rules.repeat, true);
  assert.equal(applyPatch(p, { rules: { repeat: false } }).rules.repeat, false);
  assert.throws(() => applyPatch(p, { rules: { repeat: 'no' } }), /开关/);
  assert.equal(pushOf({ rules: { repeat: false } }).rules.repeat, false);
  // The volume reaches the Bark request; changing it does not undo the test.
  const quieter = applyPatch(p, { rules: { strongVolume: 7 } });
  assert.equal(targetOf(quieter).volume, 7);
  assert.equal(fingerprint(targetOf(quieter)), p.tested);
  assert.throws(() => applyPatch(p, { rules: { dueSoon: 'yes' } }), /开关/);
  assert.throws(() => applyPatch(p, { quiet: { from: '25:00' } }), /安静时段/);
  assert.throws(() => applyPatch(p, { quiet: { from: '08:00', to: '08:00' } }), /同一个时间/);
  assert.deepEqual(applyPatch(p, { quiet: { on: true, from: '22:30' } }).quiet, { on: true, from: '22:30', to: '08:00' });
  // The key cannot be changed through a switch.
  assert.equal(applyPatch(p, { bark: { key: 'other' } }).bark.key, KEY);
});

test('the page only sees masked secrets; an untested new topic is shown in full', () => {
  const v = pushView(testedBark());
  assert.equal(JSON.stringify(v).includes(KEY), false);
  assert.equal(v.bark.keyMask, '••••StUv');
  assert.equal(v.tested, true);
  const topic = 'bb-abcdefghijklmnop';
  const fresh = pushView(pushOf({ provider: 'ntfy', ntfy: { topic } }));
  assert.equal(fresh.ntfy.topic, topic);
  const tested = pushOf({ provider: 'ntfy', ntfy: { topic } });
  tested.tested = fingerprint(targetOf(tested));
  assert.equal(pushView(tested).ntfy.topic, '');
  assert.equal(pushView(tested).ntfy.topicMask, '••••mnop');
});

test('strong-alert volume: 5 to 10, default 10; too low or not a number becomes 5', () => {
  const p = testedBark();
  const set = (v) => applyPatch(p, { rules: { strongVolume: v } }).rules.strongVolume;
  assert.equal(set(7), 7);
  assert.equal(set(5), 5);
  assert.equal(set(10), 10);
  for (const low of [4, 1, 0, -3]) assert.equal(set(low), 5);
  for (const junk of ['8', 'loud', null, NaN, Infinity, true, {}]) assert.equal(set(junk), 5);
  assert.equal(set(11), 10);
  assert.equal(set(7.6), 8);
  assert.equal(strongVolumeOf(undefined), 10);
  // Older settings with 1-4 (or junk) are read as 5; missing means 10.
  for (const old of [1, 2, 3, 4]) assert.equal(pushOf({ rules: { strongVolume: old } }).rules.strongVolume, 5);
  assert.equal(pushOf({ rules: { strongVolume: 'x' } }).rules.strongVolume, 5);
  assert.equal(pushOf({ rules: {} }).rules.strongVolume, 10);
  assert.equal(pushOf({}).rules.strongVolume, 10);
  // Even a request built by hand never goes below 5.
  assert.equal(buildRequest({ provider: 'bark', server: BARK_SERVER, secret: KEY, volume: 2 }, { title: 't', level: 'strong' }).body.volume, 5);
});

// ---- Sending ----

test('Bark and ntfy requests', () => {
  const alert = { title: 't', body: 'b', url: 'https://school.example.com/x', level: 'strong', group: '作业' };
  const bark = buildRequest({ provider: 'bark', server: BARK_SERVER, secret: KEY }, alert);
  assert.equal(bark.url, 'https://api.day.app/push');
  // Loudest by default: volume 10, the alarm ringtone, ringing on (call).
  assert.deepEqual(bark.body, { device_key: KEY, title: 't', body: 'b', group: '作业', url: alert.url, level: 'critical', call: '1', volume: 10, sound: 'alarm' });
  assert.equal(buildRequest({ provider: 'bark', server: BARK_SERVER, secret: KEY, volume: 6 }, alert).body.volume, 6);
  const normal = buildRequest({ provider: 'bark', server: BARK_SERVER, secret: KEY }, { ...alert, level: 'normal', url: 'javascript:alert(1)' });
  assert.equal(normal.body.level, 'timeSensitive');
  assert.equal(normal.body.url, undefined);
  const ntfy = buildRequest({ provider: 'ntfy', server: 'https://ntfy.sh', secret: 'bb-abcdefghijklmnop' }, alert);
  assert.equal(ntfy.url, 'https://ntfy.sh/');
  assert.deepEqual(ntfy.body, { topic: 'bb-abcdefghijklmnop', title: 't', message: 'b', priority: 5, tags: ['warning'], click: alert.url });
  assert.throws(() => buildRequest({ provider: 'ntfy', server: 'http://ntfy.sh', secret: 'x' }, alert), /https/);
});

test('sendAlert retries once, and reports problems in plain Chinese', async () => {
  const target = { provider: 'bark', server: BARK_SERVER, secret: KEY };
  let calls = 0;
  const flaky = async () => (++calls === 1 ? Promise.reject(new TypeError('fetch failed')) : new Response('{}', { status: 200 }));
  await sendAlert(target, { title: 't' }, { fetchImpl: flaky });
  assert.equal(calls, 2);
  const offline = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(sendAlert(target, { title: 't' }, { fetchImpl: offline }), (e) => e.code === 'PUSH_OFFLINE' && /没联网/.test(e.message));
  calls = 0;
  const badKey = async () => { calls += 1; return new Response('{"code":400,"message":"failed to get device token"}', { status: 400 }); };
  await assert.rejects(sendAlert(target, { title: 't' }, { fetchImpl: badKey }), (e) => e.code === 'PUSH_BADKEY' && /密钥不对/.test(e.message));
  assert.equal(calls, 1);
  const refused = async () => new Response('slow down', { status: 429 });
  await assert.rejects(sendAlert(target, { title: 't' }, { fetchImpl: refused }), (e) => e.code === 'PUSH_REFUSED');
});

// ---- Sent log ----

test('sent log: atomic save, load, record, prune after 60 days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const file = join(dir, 'push-sent.json');
    assert.deepEqual(loadSent(file), { items: {}, threads: undefined });
    const sent = record(loadSent(file), ['a#dueSoon', { thread: '_1_1|t', time: '2026-10-22T00:00:00Z' }], NOW);
    sent.items['old#overdue'] = new Date(NOW - 61 * 24 * HOUR).toISOString();
    saveSent(sent, file, NOW);
    const back = loadSent(file);
    assert.deepEqual(Object.keys(back.items), ['a#dueSoon']);
    assert.deepEqual(back.threads, { '_1_1|t': '2026-10-22T00:00:00Z' });
    assert.equal(existsSync(`${file}.tmp`), false);
    writeFileSync(file, 'not json');
    assert.deepEqual(loadSent(file), { items: {}, threads: undefined });
    assert.deepEqual(pruneSent({ items: { x: 'garbage' } }, NOW).items, { x: 'garbage' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- The checker ----

function service({ overview, fetchImpl, demo = false, dir, push = testedBark() } = {}) {
  let saved = { ...push, enabled: true };
  const logs = [];
  const s = new PushService({
    demo,
    load: () => saved,
    save: (p) => { saved = p; },
    getOverview: overview ?? (async () => ({ todo: [item('a', 4)] })),
    getMessages: async () => ({ threads: [] }),
    sentFile: demo ? null : join(dir, 'push-sent.json'),
    log: (...a) => logs.push(a.join(' ')),
    fetchImpl,
    now: () => NOW,
  });
  return { s, logs, saved: () => saved };
}

test('checker sends once and never repeats after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return new Response('{}', { status: 200 }); };
    const first = service({ dir, fetchImpl });
    assert.deepEqual(await first.s.runCheck(), { sent: 1, failed: 0, waiting: 0 });
    assert.match(first.s.state.lastResult, /发了 1 条/);
    const again = service({ dir, fetchImpl });
    assert.deepEqual(await again.s.runCheck(), { sent: 0, failed: 0, waiting: 0 });
    assert.equal(calls, 1);
    // The key never lands in the sent log.
    assert.equal(readFileSync(join(dir, 'push-sent.json'), 'utf8').includes(KEY), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checker: a failed send is retried at the next check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const down = service({ dir, fetchImpl: async () => { throw new TypeError('offline'); } });
    assert.equal((await down.s.runCheck()).failed, 1);
    assert.match(down.s.state.lastResult, /没发出去/);
    const up = service({ dir, fetchImpl: async () => new Response('{}') });
    assert.equal((await up.s.runCheck()).sent, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checker: signed out sends one login alert a day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const bodies = [];
    const fetchImpl = async (_u, init) => { bodies.push(JSON.parse(init.body)); return new Response('{}'); };
    const overview = async () => { throw Object.assign(new Error('expired'), { code: 'SESSION_EXPIRED' }); };
    await service({ dir, fetchImpl, overview }).s.runCheck();
    await service({ dir, fetchImpl, overview }).s.runCheck();
    assert.equal(bodies.length, 1);
    assert.match(bodies[0].title, /面板登录已过期，作业提醒暂停了/);
    // Other errors (network) send nothing.
    const other = service({ dir, fetchImpl, overview: async () => { throw new Error('ECONNRESET'); } });
    await other.s.runCheck();
    assert.equal(bodies.length, 1);
    assert.match(other.s.state.lastResult, /15 分钟后再试/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo mode never sends: test and checker only log', async () => {
  const fetchImpl = async () => { throw new Error('must not be called'); };
  const { s, logs, saved } = service({ demo: true, fetchImpl, push: pushOf({}) });
  const view = await s.test({ provider: 'bark', barkLink: `https://api.day.app/${KEY}/` });
  assert.equal(view.tested, true);
  assert.equal(view.demo, true);
  s.update({ enabled: true });
  await s.runCheck();
  assert.ok(logs.every((l) => l.startsWith('[示例模式] 不会真的发送')));
  assert.equal(logs.length, 2);
  assert.equal(saved().enabled, true);
  s.stop();
});

test('test saves a new key only after the phone was reached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const other = 'ZyXwVuTsRqPoNmLkJiHgFe';
    const fail = service({ dir, fetchImpl: async () => { throw new TypeError('offline'); } });
    await assert.rejects(fail.s.test({ provider: 'bark', barkLink: other }), /没联网/);
    assert.equal(fail.saved().bark.key, KEY);
    assert.equal(fail.saved().enabled, true);
    const ok = service({ dir, fetchImpl: async () => new Response('{}') });
    const view = await ok.s.test({ provider: 'bark', barkLink: other });
    assert.equal(ok.saved().bark.key, other);
    // A different phone starts switched off.
    assert.equal(view.enabled, false);
    assert.equal(view.tested, true);
    ok.s.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('试听强提醒: a loud test alert, clearly marked, never in the sent log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'push-'));
  try {
    const bodies = [];
    const fetchImpl = async (_u, init) => { bodies.push(JSON.parse(init.body)); return new Response('{}'); };
    const { s } = service({ dir, fetchImpl });
    assert.deepEqual(await s.trial({ volume: 8 }), { volume: 8 });
    assert.equal(bodies[0].level, 'critical');
    assert.equal(bodies[0].call, '1');
    assert.equal(bodies[0].sound, 'alarm');
    assert.equal(bodies[0].volume, 8);
    assert.match(bodies[0].title, /测试强提醒（不是真的作业）/);
    assert.match(bodies[0].body, /音量 8，闹钟铃声/);
    // Too low becomes 5; without a volume, the saved one (10).
    assert.equal((await s.trial({ volume: 2 })).volume, 5);
    assert.equal((await s.trial()).volume, 10);
    assert.equal(existsSync(join(dir, 'push-sent.json')), false);
    // The real alert for an assignment still goes afterwards.
    assert.equal((await s.runCheck()).sent, 1);
    assert.equal(bodies.at(-1).title.startsWith('⚠️ 还没交'), true);
    // Needs a phone that passed the normal test.
    const fresh = service({ dir, fetchImpl, push: pushOf({ bark: { key: KEY } }) });
    await assert.rejects(fresh.s.trial({ volume: 10 }), (e) => e.code === 'NOT_TESTED');
    s.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('试听强提醒 in demo mode only logs', async () => {
  const { s, logs } = service({ demo: true, fetchImpl: async () => { throw new Error('must not be called'); } });
  await s.trial({ volume: 10 });
  assert.equal(logs.length, 1);
  assert.ok(logs[0].startsWith('[示例模式] 不会真的发送。本来会发到手机：（强提醒）🔔 测试强提醒'));
});

test('changing the ntfy topic pauses alerts until it is tested again', () => {
  const p = pushOf({ provider: 'ntfy', ntfy: { topic: 'bb-abcdefghijklmnop' } });
  p.tested = fingerprint(targetOf(p));
  const { s, saved } = service({ push: p, dir: tmpdir() });
  const view = s.changeTopic();
  assert.equal(saved().enabled, false);
  assert.notEqual(saved().ntfy.topic, 'bb-abcdefghijklmnop');
  assert.equal(view.ntfy.topic, saved().ntfy.topic);
  s.stop();
});

// ---- 开机自动启动 ----

test('autostart: a .cmd in the Startup folder, and moved folders are noticed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'autostart-'));
  try {
    const env = { APPDATA: join(dir, 'AppData') };
    const opts = { env, platform: 'win32' };
    const app = join(dir, '学习面板');
    const text = launcherText(app);
    assert.match(text, /^@echo off\r\nchcp 65001/);
    assert.match(text, /\/min cmd \/c ""[^"]+start\.bat" --background"/);
    assert.equal(appDirIn(text), app);
    assert.deepEqual(autostartStatus(app, opts), { supported: true, on: false });
    assert.deepEqual(setAutostart(true, app, opts), { supported: true, on: true });
    const file = join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'blackboard-study-hub.cmd');
    assert.ok(existsSync(file));
    // This copy moved somewhere else: the old folder is gone.
    assert.equal(autostartStatus(join(dir, 'new'), opts).problem, 'missing');
    // Another copy still exists at the old place.
    writeFileSync(join(dir, 'start.bat'), '');
    writeFileSync(file, launcherText(dir));
    assert.equal(autostartStatus(app, opts).problem, 'moved');
    assert.deepEqual(setAutostart(false, app, opts), { supported: true, on: false });
    assert.equal(existsSync(file), false);
    assert.deepEqual(autostartStatus(app, { env, platform: 'darwin' }), { supported: false, on: false });
    assert.throws(() => setAutostart(true, app, { env, platform: 'linux' }), /只支持 Windows/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
