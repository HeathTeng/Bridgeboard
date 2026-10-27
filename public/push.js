// 手机提醒: the settings card. The server keeps the Bark key and ntfy topic and
// only ever shows them masked; a new ntfy topic is shown in full until tested.
import { $, actionLine, api, el, fmt, osWords } from './ui.js';
import { relativeTime } from './message-view.js';
import { alertsSummary } from './section-summary.js';
import { clearError, flagError, setAlertsOn, setSummary } from './layout.js';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let view;
let topicShown = '';

function msg(id, text, cls = 'small') {
  $(id).className = cls;
  $(id).textContent = text;
}

function provider() {
  return document.querySelector('input[name="pushProvider"]:checked')?.value ?? 'bark';
}

function renderStatus() {
  setSummary('alerts', alertsSummary(view));
  const box = $('pushStatus');
  if (!view?.enabled) {
    box.replaceChildren(el('p', { class: 'muted' }, view?.tested
      ? '提醒现在是关着的。打开上面的开关就会开始检查。'
      : '提醒现在是关着的。先完成下面第 1 步（发一条测试，手机收到了），再打开上面的开关。'));
    return;
  }
  const s = view.status ?? {};
  const now = Date.now();
  const last = s.checking ? '正在检查…' : s.lastCheck ? `上次检查：${relativeTime(s.lastCheck, now)}` : '马上进行第一次检查';
  const next = s.nextCheck && !s.checking ? ` · 下次检查：${fmt.format(new Date(s.nextCheck))}` : '';
  const checkNow = el('button', { type: 'button', class: 'inline-action' }, '现在检查一次');
  checkNow.addEventListener('click', checkOnce);
  box.replaceChildren(...[
    el('p', { class: 'action-line' }, el('span', { class: 'ok' }, `✅ 提醒已打开。${last}${next}`), checkNow),
    s.lastResult ? el('p', { class: 'muted' }, `结果：${s.lastResult}`) : null,
    view.demo ? el('p', { class: 'muted' }, `示例模式不会真的发送，只会在${osWords().window}里显示本来会发什么。`) : null,
  ].filter(Boolean));
}

function renderTopic() {
  const t = topicShown || view.ntfy.topic;
  $('ntfyTopic').textContent = t || view.ntfy.topicMask || '（点「换一个」生成）';
  $('topicShow').hidden = Boolean(t) || !view.ntfy.topicMask;
}

function renderAutostart() {
  const a = view.autostart ?? {};
  $('autostartBox').hidden = !a.supported;
  // Mac: a note instead of a switch that would do nothing.
  $('autostartMac').hidden = !a.mac;
  if (!a.supported) return;
  $('autostartOn').checked = Boolean(a.on);
  $('autostartOn').disabled = Boolean(view.demo);
  const box = $('autostartMsg');
  if (view.demo) return box.replaceChildren(el('p', { class: 'muted small' }, '示例模式不会改开机启动。'));
  if (!a.problem) return box.replaceChildren();
  const text = a.problem === 'moved'
    ? '⚠️ 开机启动指向的是另一个文件夹里的面板（可能是旧版本或复制过的）。'
    : '⚠️ 开机启动找不到面板了：程序文件夹可能被移动过，或者在一个没插上的 U 盘里。';
  box.replaceChildren(actionLine(text, [
    { label: '改成现在这个文件夹', onClick: () => setAutostart(true) },
    { label: '删除开机启动', onClick: () => setAutostart(false) },
  ]));
}

function render() {
  $('pushOn').checked = view.enabled;
  for (const r of document.querySelectorAll('input[name="pushProvider"]')) r.checked = r.value === view.provider;
  $('barkSetup').hidden = view.provider !== 'bark';
  $('ntfySetup').hidden = view.provider !== 'ntfy';
  $('barkSaved').textContent = view.bark.keyMask
    ? `已保存的 Bark 密钥：${view.bark.keyMask}${view.bark.custom ? `（自建服务器 ${view.bark.server}）` : ''}。换手机时，粘贴新链接再测试一次。`
    : '';
  if (document.activeElement !== $('ntfyServer')) $('ntfyServer').value = view.ntfy.custom ? view.ntfy.server : '';
  renderTopic();
  $('rDueSoon').checked = view.rules.dueSoon;
  $('rStrong').checked = view.rules.strong;
  $('strongHours').value = String(view.rules.strongHours);
  $('strongVolume').value = String(view.rules.strongVolume);
  $('rOverdue').checked = view.rules.overdue;
  $('rRepeat').checked = view.rules.repeat;
  // Repeats belong to the strong alert: greyed out when it is off or N is already 1 hour.
  $('rRepeat').disabled = !view.rules.strong || view.rules.strongHours <= 1;
  $('rMessages').checked = view.rules.messages;
  $('hideNames').checked = view.hideNames;
  $('quietOn').checked = view.quiet.on;
  $('quietFrom').value = view.quiet.from;
  $('quietTo').value = view.quiet.to;
  renderStatus();
  renderAutostart();
}

/** Called by the page when the timeline changes, so the hint shows the right number. */
export function setDueSoonHours(hours) {
  $('dueSoonHint').textContent = `离截止还剩 ${hours} 小时时提醒（和截止日期区域时间轴里的"临期"一样，在那里可以改）。`;
}

/** Only the 上次检查 line, so switches and typing are left alone. */
async function refreshStatus() {
  if (document.hidden || !view) return;
  try {
    const fresh = await api('/api/push');
    view.status = fresh.status;
    view.enabled = fresh.enabled;
    renderStatus();
  } catch {}
}

async function load() {
  try {
    view = await api('/api/push');
    setAlertsOn(view.enabled);
    clearError('alerts');
    render();
  } catch (err) {
    setSummary('alerts', '设置没有读取成功，点开看怎么办');
    flagError('alerts');
    msg('pushMsg', `手机提醒的设置没有读取成功：${err.message}`, 'small fail');
  }
}

/** Saves one change from a switch; on failure shows why and puts the switch back. */
async function save(patch, okText = '已保存。') {
  try {
    view = await api('/api/push', json('POST', patch));
    msg('pushMsg', view.demo ? `${okText}（示例模式：只在这次运行时有效。）` : okText, 'small ok');
  } catch (err) {
    msg('pushMsg', `没有保存：${err.message}`, 'small fail');
    if (err.code === 'NOT_TESTED') $('pushTest').focus();
  }
  render();
}

async function sendTest() {
  const p = provider();
  const body = { provider: p };
  if (p === 'bark') {
    body.barkLink = $('barkLink').value;
    if (!body.barkLink.trim() && !view.bark.keyMask) {
      msg('pushTestMsg', '请先把 Bark 里的链接粘贴到上面的框里。', 'small fail');
      return $('barkLink').focus();
    }
  } else {
    body.ntfyServer = $('ntfyServer').value;
  }
  $('pushTest').disabled = true;
  msg('pushTestMsg', '正在发送…');
  try {
    view = await api('/api/push/test', json('POST', body));
    $('barkLink').value = '';
    msg('pushTestMsg', view.demo
      ? `示例模式不会真的发送（${osWords().window}里显示了本来会发的内容）。真实使用时，手机会收到「测试成功 ✅」。`
      : '已发送 ✅ 手机收到「测试成功」了吗？收到了就可以打开最上面的「打开手机提醒」。没收到的话，看看手机是否允许 Bark / ntfy 发通知、是否开着勿扰或专注模式。', 'small ok');
    render();
  } catch (err) {
    msg('pushTestMsg', err.message, 'small fail');
  } finally {
    $('pushTest').disabled = false;
  }
}

async function trial() {
  $('pushTrial').disabled = true;
  msg('trialMsg', '正在发送…');
  try {
    const r = await api('/api/push/trial', json('POST', { volume: Number($('strongVolume').value) }));
    msg('trialMsg', r.demo
      ? `示例模式不会真的发送（${osWords().window}里显示了本来会发的内容）。`
      : view.provider === 'bark'
        ? `已发送 ✅ 手机应该用音量 ${r.volume} 的闹钟铃声响起来，静音时也会响。没响的话，看看 iPhone 设置 → 通知 → Bark 里「重要警告」有没有打开。`
        : '已发送 ✅ 手机应该以最高优先级响起来。', 'small ok push-hint');
  } catch (err) {
    msg('trialMsg', err.message, 'small fail push-hint');
  } finally {
    $('pushTrial').disabled = false;
  }
}

async function checkOnce() {
  msg('pushMsg', '正在检查…');
  try {
    view = await api('/api/push/check', { method: 'POST' });
    msg('pushMsg', '检查完了。', 'small ok');
  } catch (err) {
    msg('pushMsg', err.message, 'small fail');
  }
  render();
}

async function setAutostart(on) {
  try {
    view = await api('/api/push/autostart', json('POST', { on }));
    msg('pushMsg', on ? '已设置：下次开电脑后，面板会自动在后台运行。' : '已关闭开机自动启动。', 'small ok');
  } catch (err) {
    msg('pushMsg', `没有改成功：${err.message}`, 'small fail');
  }
  render();
}

async function showTopic() {
  try {
    topicShown = (await api('/api/push/topic')).topic;
    renderTopic();
  } catch (err) {
    msg('pushTestMsg', err.message, 'small fail');
  }
}

async function copyTopic() {
  try {
    if (!topicShown && !view.ntfy.topic) await showTopic();
    await navigator.clipboard.writeText(topicShown || view.ntfy.topic);
    msg('pushTestMsg', '已复制。在手机 ntfy 里点 +，粘贴到 Topic 里。', 'small ok');
  } catch {
    msg('pushTestMsg', '没能自动复制，请照着上面的名字手动输入。', 'small fail');
  }
}

export function initPush() {
  $('strongHours').replaceChildren(...Array.from({ length: 24 }, (_, i) => el('option', { value: String(i + 1) }, String(i + 1))));
  // 5 is about a normal ringtone; strong alerts never go quieter.
  $('strongVolume').replaceChildren(...[10, 9, 8, 7, 6, 5].map((v) => el('option', { value: String(v) }, v === 10 ? '10（最大）' : v === 5 ? '5（约等于普通铃声）' : String(v))));
  $('pushOn').addEventListener('change', () => {
    const on = $('pushOn').checked;
    save({ enabled: on }, on ? `提醒已打开。电脑开着、${osWords().window}开着时，每 15 分钟检查一次。` : '提醒已关闭，不会再发到手机。');
  });
  for (const r of document.querySelectorAll('input[name="pushProvider"]')) {
    r.addEventListener('change', async () => {
      msg('pushTestMsg', '');
      await save({ provider: r.value }, r.value === 'ntfy' ? '已选安卓手机。按下面的步骤订阅，再发一条测试。' : '已选苹果手机。按下面的步骤粘贴链接，再发一条测试。');
      if (r.value === 'ntfy' && !view.ntfy.topic && !view.ntfy.topicMask) showTopic();
    });
  }
  $('pushTest').addEventListener('click', sendTest);
  $('topicShow').addEventListener('click', showTopic);
  $('topicCopy').addEventListener('click', copyTopic);
  $('topicNew').addEventListener('click', async () => {
    try {
      view = await api('/api/push/topic', { method: 'POST' });
      topicShown = view.ntfy.topic;
      msg('pushTestMsg', '已换成新名字。请在手机 ntfy 里删掉旧的订阅，订阅这个新名字，然后再发一条测试。', 'small ok');
      render();
    } catch (err) {
      msg('pushTestMsg', err.message, 'small fail');
    }
  });
  const rule = (id, key) => $(id).addEventListener('change', () => save({ rules: { [key]: $(id).checked } }));
  rule('rDueSoon', 'dueSoon');
  rule('rStrong', 'strong');
  rule('rOverdue', 'overdue');
  rule('rRepeat', 'repeat');
  rule('rMessages', 'messages');
  $('strongHours').addEventListener('change', () => save({ rules: { strongHours: Number($('strongHours').value) } }));
  $('strongVolume').addEventListener('change', () => save({ rules: { strongVolume: Number($('strongVolume').value) } }));
  $('pushTrial').addEventListener('click', trial);
  $('hideNames').addEventListener('change', () => save({ hideNames: $('hideNames').checked }));
  $('quietOn').addEventListener('change', () => save({ quiet: { on: $('quietOn').checked } }));
  for (const id of ['quietFrom', 'quietTo']) {
    $(id).addEventListener('change', () => { if ($(id).value) save({ quiet: { [id === 'quietFrom' ? 'from' : 'to']: $(id).value } }); });
  }
  $('autostartOn').addEventListener('change', () => setAutostart($('autostartOn').checked));
  // Keep 上次检查 fresh while the page is open.
  setInterval(refreshStatus, 60 * 1000);
  return load();
}

/** After the server comes back (the black window was reopened). */
export const reloadPush = load;
