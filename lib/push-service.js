// The phone-alert checker: while alerts are on, looks at the deadlines every
// 15 minutes (and once at start), sends what push-rules.js says is due, and
// remembers it in push-sent.json. Demo mode never sends: it prints what it
// would have sent in the black window.
import { planAlerts } from './push-rules.js';
import {
  PUSH_DEFAULTS, TEST_MESSAGE, applyPatch, strongVolumeOf, checkServer, fingerprint, isTested, loadSent, newTopic, parseBark, pushOf,
  pushView, record, saveSent, sendAlert, targetOf,
} from './push.js';

const MINUTE = 60 * 1000;
export const CHECK_EVERY = 15 * MINUTE;
const FIRST_CHECK = 5 * 1000;
const SIGNED_OUT = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'NOT_CONFIGURED']);
const LOGIN_ALERT = { level: 'normal', group: '面板', title: '面板登录已过期，作业提醒暂停了。', body: '请在电脑上重新连接。' };

const sameLocalDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export class PushService {
  /**
   * demo: never send. load/save: the push settings (settings.json, or memory).
   * timeline(): the deadline timeline durations. getOverview/getMessages: the
   * server's cached Blackboard fetches. sentFile: the sent log (null in demo).
   */
  constructor({ demo = false, load, save, timeline = () => ({}), getOverview, getMessages, sentFile, log = console.log, fetchImpl, every = CHECK_EVERY, now = Date.now }) {
    Object.assign(this, { demo, load, save, timeline, getOverview, getMessages, sentFile, log, fetchImpl, every, now });
    this.memorySent = { items: {}, threads: undefined };
    this.state = { lastCheck: null, nextCheck: null, lastResult: '' };
  }

  push() {
    return pushOf(this.load());
  }

  sent() {
    return this.sentFile ? loadSent(this.sentFile) : structuredClone(this.memorySent);
  }

  keepSent(sent) {
    if (this.sentFile) saveSent(sent, this.sentFile, this.now());
    else this.memorySent = sent;
  }

  view(extra = {}) {
    return { ...pushView(this.push(), extra), status: { ...this.state, checking: Boolean(this.running) }, demo: this.demo };
  }

  // ---- Timer ----

  start() {
    if (this.push().enabled) this.schedule(FIRST_CHECK);
  }

  schedule(ms = this.every) {
    clearTimeout(this.timer);
    if (!this.push().enabled) {
      this.state.nextCheck = null;
      return;
    }
    this.state.nextCheck = new Date(this.now() + ms).toISOString();
    this.timer = setTimeout(() => this.check().catch((err) => this.log('提醒检查出错：', err.message)), ms);
  }

  stop() {
    clearTimeout(this.timer);
  }

  // ---- Sending ----

  async deliver(target, alert) {
    if (this.demo) {
      this.log(`[示例模式] 不会真的发送。本来会发到手机：${alert.level === 'strong' ? '（强提醒）' : ''}${alert.title}${alert.body ? ` | ${alert.body.replace(/\n/g, ' / ')}` : ''}`);
      return;
    }
    await sendAlert(target, alert, { fetchImpl: this.fetchImpl });
  }

  /** One check. Returns { sent, failed, waiting }; never runs twice at once. */
  check() {
    this.running ??= this.runCheck().finally(() => {
      this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  async runCheck() {
    const push = this.push();
    if (!push.enabled) return { sent: 0, failed: 0, waiting: 0 };
    const target = targetOf(push);
    const now = this.now();
    this.state.lastCheck = new Date(now).toISOString();
    const sent = this.sent();

    let overview;
    try {
      overview = await this.getOverview();
    } catch (err) {
      if (!SIGNED_OUT.has(err.code)) {
        this.state.lastResult = `这次没有读到 Blackboard 的数据（${err.message}），15 分钟后再试。`;
        return { sent: 0, failed: 0, waiting: 0 };
      }
      this.state.lastResult = '登录已过期，提醒暂停了。请在电脑上重新连接 Blackboard。';
      // One alert a day, so the student knows the reminders have stopped.
      if (!sent.login || !sameLocalDay(sent.login, now)) {
        try {
          await this.deliver(target, LOGIN_ALERT);
          sent.login = new Date(now).toISOString();
          this.keepSent(sent);
        } catch (e) {
          this.log('登录过期提醒没有发出去：', e.message);
        }
      }
      return { sent: 0, failed: 0, waiting: 0 };
    }

    let threads;
    if (push.rules.messages) threads = (await this.getMessages().catch(() => null))?.threads;
    const plan = planAlerts({ todo: overview.todo, threads, now, settings: this.timeline(), push, sent });
    if (threads) sent.threads = { ...sent.threads, ...plan.threadUpdates };

    let delivered = 0;
    let failed = 0;
    let lastError = '';
    for (const alert of plan.alerts) {
      try {
        await this.deliver(target, alert);
        record(sent, alert.records, now);
        delivered += 1;
      } catch (err) {
        // Not recorded, so the next check tries again.
        failed += 1;
        lastError = err.message;
      }
    }
    this.keepSent(sent);
    const parts = [delivered ? `发了 ${delivered} 条提醒${this.demo ? '（示例模式，没有真的发送）' : ''}` : '没有需要提醒的'];
    if (plan.waiting) parts.push(`安静时段，${plan.waiting} 条等结束后再发`);
    if (failed) parts.push(`${failed} 条没发出去，下次检查再试：${lastError}`);
    this.state.lastResult = `${parts.join('；')}。`;
    return { sent: delivered, failed, waiting: plan.waiting };
  }

  // ---- Changes from the page ----

  update(patch) {
    const before = this.push();
    const next = applyPatch(before, patch);
    this.save(next);
    // Message alerts just switched on: start from what is there now, not from old messages.
    if (next.rules.messages && !before.rules.messages) {
      const sent = this.sent();
      sent.threads = undefined;
      this.keepSent(sent);
    }
    if (next.enabled !== before.enabled) this.schedule(next.enabled ? FIRST_CHECK : undefined);
    return this.view();
  }

  /**
   * 发一条测试. body: { provider, barkLink?, ntfyServer? }. Saves the key,
   * topic or server only after the phone was reached, and marks it tested.
   */
  async test(body = {}) {
    const push = this.push();
    const next = structuredClone(push);
    next.provider = body.provider === 'ntfy' ? 'ntfy' : 'bark';
    if (next.provider === 'bark' && String(body.barkLink ?? '').trim()) next.bark = parseBark(body.barkLink);
    if (next.provider === 'ntfy') {
      if (String(body.ntfyServer ?? '').trim()) next.ntfy.server = checkServer(body.ntfyServer);
      else if (body.ntfyServer !== undefined) next.ntfy.server = PUSH_DEFAULTS.ntfy.server;
      if (!next.ntfy.topic) next.ntfy.topic = newTopic();
    }
    const target = targetOf(next);
    if (!target) throw Object.assign(new Error('请先粘贴 Bark 里显示的链接。'), { status: 400 });
    await this.deliver(target, { level: 'normal', group: '面板', title: 'Blackboard 学习面板', body: TEST_MESSAGE });
    next.tested = fingerprint(target);
    // Same phone as before: keep alerts as they were. A new one starts switched off.
    next.enabled = push.enabled && isTested(push) && push.tested === next.tested;
    this.save(next);
    return this.view();
  }

  /**
   * 试听强提醒: one strong alert at the chosen volume with the alarm sound,
   * clearly marked as a test. Not written to the sent log, so real alerts
   * for assignments are not affected. body: { volume? } (what the page shows now).
   */
  async trial(body = {}) {
    const push = this.push();
    if (!isTested(push)) {
      throw Object.assign(new Error('请先完成第 1 步：发一条普通测试，确认手机能收到，再试听强提醒。'), { status: 400, code: 'NOT_TESTED' });
    }
    const volume = strongVolumeOf('volume' in body ? body.volume : push.rules.strongVolume);
    const target = { ...targetOf(push), volume };
    const loud = push.provider === 'bark' ? `音量 ${volume}，闹钟铃声` : '最高优先级';
    await this.deliver(target, {
      level: 'strong',
      group: '面板',
      title: '🔔 测试强提醒（不是真的作业）',
      body: `这是试听：${loud}。作业快截止还没交时，手机会这样响。`,
    });
    return { volume };
  }

  /** 换一个: a new ntfy topic. The old one stops working, so alerts pause until the new one is tested. */
  changeTopic() {
    const next = this.push();
    next.ntfy.topic = newTopic();
    if (next.provider === 'ntfy') next.enabled = false;
    this.save(next);
    this.schedule();
    return this.view({ showTopic: true });
  }

  /** The full ntfy topic, for 显示 and 复制 on this computer's page only. */
  topic() {
    const push = this.push();
    if (!push.ntfy.topic) {
      push.ntfy.topic = newTopic();
      this.save(push);
    }
    return { topic: push.ntfy.topic };
  }
}
