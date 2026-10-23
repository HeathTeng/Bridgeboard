// "Connect Blackboard": opens a separate Edge (or Chrome) window, lets the
// student sign in exactly as usual, then reads the session cookies through the
// browser's local debugging interface (CDP). No DevTools, no copy and paste.
//
// The window uses its own profile folder, never the student's everyday
// browser data, and the debugging port listens on 127.0.0.1 only and closes
// with the window.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const POLL_MS = 1500;
const TIMEOUT_MS = 10 * 60 * 1000;

export function profileDir() {
  // Old name kept on purpose after the rename to Bridgeboard: existing users' data lives in this folder.
  return process.env.BB_HUB_BROWSER_PROFILE ?? join(homedir(), '.blackboard-study-hub', 'browser-profile');
}

/** True once a pop-up sign-in has run, so there may be a saved SSO login to reuse. */
export function hasProfile() {
  return existsSync(join(profileDir(), 'Default'));
}

/** Finds an installed Chromium-based browser, Edge first. */
export function findBrowser() {
  if (process.env.BB_HUB_BROWSER) return process.env.BB_HUB_BROWSER;
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = {
    win32: [
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    darwin: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
    linux: ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] ?? [];
  return candidates.find((p) => p && existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal CDP client over the browser-level WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('无法连接到浏览器调试接口')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });
  ws.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('浏览器窗口已关闭'));
    pending.clear();
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error('浏览器窗口已关闭'));
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

/** Cookies that a request to `host` would carry. */
export function cookiesForHost(cookies, host) {
  return cookies.filter((c) => {
    const domain = c.domain.replace(/^\./, '');
    return host === domain || host.endsWith(`.${domain}`);
  });
}

export function cookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Opens the browser at `baseUrl`, waits for a signed-in session, and returns
 * `{ cookie, userAgent }` once `validate(cookie, userAgent)` accepts it.
 * `onStatus` receives short progress messages for the UI.
 */
export async function captureSession({ baseUrl, validate, onStatus = () => {}, timeoutMs = TIMEOUT_MS, silent = false }) {
  const exe = findBrowser();
  if (!exe) throw new Error('没有找到 Edge 或 Chrome 浏览器。请改用"手动粘贴"方式登录。');

  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  const portFile = join(dir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });

  const host = new URL(baseUrl).hostname;
  const child = spawn(exe, [
    `--user-data-dir=${dir}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeSidebarV2,msImplicitSignin',
    '--new-window',
    // Silent renewal: no window; works only while the school's SSO login saved
    // in this profile is still valid.
    ...(silent ? ['--headless=new'] : []),
    ...(process.env.BB_HUB_BROWSER_ARGS ? process.env.BB_HUB_BROWSER_ARGS.split(' ') : []),
    `${baseUrl}/ultra`,
  ], { stdio: 'ignore', detached: false, windowsHide: false });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; });

  onStatus('已打开浏览器窗口，请在里面登录学校账号…');

  // The browser writes its debugging port to this file once it is listening.
  const deadline = Date.now() + timeoutMs;
  let wsUrl;
  while (!wsUrl) {
    if (exited) throw new Error('浏览器窗口没有启动成功，或已被关闭。');
    if (Date.now() > deadline) throw new Error('等待超时。');
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, 'utf8').split(/\r?\n/);
      if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
    }
    if (!wsUrl) await sleep(300);
  }

  const cdp = await connect(wsUrl);
  try {
    const { userAgent } = await cdp.send('Browser.getVersion');
    let lastTried = '';
    while (Date.now() < deadline) {
      let all;
      try {
        ({ cookies: all } = await cdp.send('Storage.getCookies'));
      } catch {
        throw new Error('浏览器窗口在登录完成前被关闭了。');
      }
      const mine = cookiesForHost(all, host);
      // BbRouter only identifies a signed-in Blackboard session once SSO is done;
      // check it against the live API, but only when the cookies have changed.
      if (mine.some((c) => c.name === 'BbRouter')) {
        const cookie = cookieHeader(mine);
        if (cookie !== lastTried) {
          lastTried = cookie;
          onStatus('检测到登录信息，正在验证…');
          const result = await validate(cookie, userAgent).catch(() => null);
          if (result) {
            onStatus('登录成功，正在关闭浏览器窗口…');
            await cdp.send('Browser.close').catch(() => {});
            return { ...result, cookie, userAgent };
          }
          onStatus('已打开浏览器窗口，请在里面完成登录…');
        }
      }
      await sleep(POLL_MS);
    }
    throw new Error('等待登录超时（10 分钟），请重试。');
  } finally {
    cdp.close();
    if (!exited) setTimeout(() => { try { child.kill(); } catch {} }, 3000).unref();
  }
}
