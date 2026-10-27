// Small helpers shared by the page: DOM building, requests with plain-Chinese
// errors, and noticing when the local server (the black window) has gone.

import { wordsFor } from './os-words.js';

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export const fmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The system the panel runs on: data-os on <html>, set by theme.js and then by applyOs in layout.js. */
export const currentOs = () => (document.documentElement.dataset.os === 'mac' ? 'mac' : 'windows');
/** 黑色窗口 / 终端窗口, start.bat / start.command and the like for this computer. */
export const osWords = () => wordsFor(currentOs());

export function serverLost() {
  const w = osWords();
  return `面板已停止运行（可能是${w.window}被关掉了）。请重新双击 ${w.launcher}。`;
}
const SIGNED_OUT_CODES = ['NOT_AUTHENTICATED', 'SESSION_EXPIRED', 'NOT_CONFIGURED'];
const CJK = /[㐀-鿿]/;

export const isSignedOutError = (err) => SIGNED_OUT_CODES.includes(err?.code);

/**
 * What the student reads for an error: our own Chinese messages pass
 * through; English library errors and bare codes become a plain next step.
 * The original always goes to the console.
 */
export function friendlyText(text, code, status) {
  if (SIGNED_OUT_CODES.includes(code)) return '登录已过期，请重新连接 Blackboard。';
  if (code === 'SERVER_DOWN') return serverLost();
  if (text && CJK.test(text)) return text;
  if (code === 'FORBIDDEN' || status === 403) return '没有权限查看这部分内容。';
  if (status === 404) return '找不到要找的内容，请点右上角的「刷新」再试。';
  return '出了点问题，请点右上角的「刷新」重试。如果一直这样，请重新连接 Blackboard。';
}

// ---- The server going away ----

let serverDown = false;
let failures = 0;
let onDown = () => {};
let onUp = () => {};
let checkTimer;

async function checkServer() {
  clearTimeout(checkTimer);
  let ok = false;
  try {
    ok = (await fetch('/api/config', { cache: 'no-store' })).ok;
  } catch {}
  if (ok) {
    failures = 0;
    if (serverDown) {
      serverDown = false;
      onUp();
    }
  } else {
    noteFailure();
  }
  // Every 30 seconds while running; every 5 while waiting for it to come back.
  checkTimer = setTimeout(checkServer, serverDown ? 5000 : 30_000);
}

function noteFailure() {
  failures += 1;
  if (failures >= 2 && !serverDown) {
    serverDown = true;
    onDown();
  } else if (!serverDown) {
    // One failure might be a blip: look again soon rather than in 30 seconds.
    clearTimeout(checkTimer);
    checkTimer = setTimeout(checkServer, 2000);
  }
}

/** Calls down() after two failed contacts in a row and up() when it answers again. */
export function watchServer(down, up) {
  onDown = down;
  onUp = up;
  checkTimer = setTimeout(checkServer, 30_000);
}

/**
 * fetch + JSON, throwing errors whose message is already plain Chinese.
 * With `timeoutMs`, a request that takes longer fails with code TIMEOUT;
 * a slow answer is not the black window being closed, so it does not count
 * towards SERVER_DOWN.
 */
export async function api(path, { timeoutMs, ...options } = {}) {
  if (serverDown) throw Object.assign(new Error(serverLost()), { code: 'SERVER_DOWN' });
  let res;
  try {
    res = await fetch(path, timeoutMs ? { ...options, signal: AbortSignal.timeout(timeoutMs) } : options);
  } catch (err) {
    console.error(path, err);
    if (err.name === 'TimeoutError') throw Object.assign(new Error('学校服务器回应太慢，正在重试。'), { code: 'TIMEOUT' });
    noteFailure();
    throw Object.assign(new Error(serverLost()), { code: 'SERVER_DOWN' });
  }
  failures = 0;
  const data = await res.json().catch((err) => {
    if (err.name === 'TimeoutError') throw Object.assign(new Error('学校服务器回应太慢，正在重试。'), { code: 'TIMEOUT' });
    return {};
  });
  if (!res.ok) {
    console.error(path, res.status, data);
    throw Object.assign(new Error(), data, { message: friendlyText(data.error, data.code, res.status), status: res.status });
  }
  return data;
}

/** An error or hint line with buttons for the obvious next step. */
export function actionLine(text, actions = [], cls = 'fail small') {
  return el('p', { class: `action-line ${cls}` }, text, ...actions.map(({ label, onClick }) => {
    const b = el('button', { type: 'button', class: 'inline-action' }, label);
    b.addEventListener('click', onClick);
    return b;
  }));
}
