// "Connect Blackboard": opens a separate Edge (or Chrome) window, lets the
// student sign in exactly as usual, then reads the session cookies through the
// browser's local debugging interface (CDP). No DevTools, no copy and paste.
//
// The window uses its own profile folder, never the student's everyday
// browser data, and the debugging port listens on 127.0.0.1 only and closes
// with the window.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const POLL_MS = 1500;
const TIMEOUT_MS = 10 * 60 * 1000;
/** Silent renewal gives up once the hidden window has sat on a sign-in page this long. */
export const SIGN_IN_STUCK_MS = 12 * 1000;

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
    /** `sessionId` sends to one tab (from Target.attachToTarget with flatten). */
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) return reject(new Error('浏览器窗口已关闭'));
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
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

/**
 * Whether a page in the sign-in window is a sign-in form: Blackboard's own
 * login page (the site root, often with ?new_loc=…, or /webapps/login) or any
 * page off the school's host (the school's SSO). Passing through SSO takes a
 * moment when its login is still saved; staying there means someone has to
 * type, which a hidden window cannot do.
 */
export function onSignInPage(pageUrl, host) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false; // about:blank, edge://…
  if (u.hostname !== host) return true;
  return u.pathname === '/' || u.pathname.startsWith('/webapps/login');
}

/** The first ordinary tab in the browser, if any: { targetId, url }. */
async function firstPage(cdp) {
  const { targetInfos = [] } = await cdp.send('Target.getTargets').catch(() => ({}));
  return targetInfos.find((t) => t.type === 'page');
}

async function pageUrl(cdp) {
  return (await firstPage(cdp))?.url ?? '';
}

/** Microsoft's sign-in pages, where a wrong-account error (AADSTS…) shows. */
export function isMicrosoftLogin(pageUrl) {
  try {
    return /(^|.)(login.microsoftonline.com|login.live.com)$/.test(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * The account is not one of the school's: AADSTS50020 (a personal Microsoft
 * account, e.g. from live.com, signed in to a school tenant) or AADSTS50034
 * (no such account in the school's directory).
 */
export const WRONG_ACCOUNT_CODES = ['AADSTS50020', 'AADSTS50034'];

/**
 * The script run in the sign-in tab: it answers only true or false, so no
 * page text ever leaves the tab. textContent also covers the folded
 * "troubleshooting details" where Microsoft puts the code.
 */
export const WRONG_ACCOUNT_CHECK = `/\\b(${WRONG_ACCOUNT_CODES.join('|')})\\b/.test(document.body ? document.body.textContent : '')`;

/**
 * Whether the sign-in tab shows a wrong-account error. Checks Microsoft's
 * pages only; nothing from the page is kept, logged or sent, only the yes or no.
 */
async function showsWrongAccount(cdp) {
  const page = await firstPage(cdp);
  if (!page || !isMicrosoftLogin(page.url)) return false;
  let sessionId;
  try {
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true }));
    const { result } = await cdp.send('Runtime.evaluate', { expression: WRONG_ACCOUNT_CHECK, returnByValue: true }, sessionId);
    return result?.value === true;
  } catch {
    return false;
  } finally {
    if (sessionId) cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
  }
}

/** Shown on the panel while the sign-in window is on a wrong-account error. */
export const WRONG_ACCOUNT_TEXT = '登录用的不是学校账号。在登录窗口点「使用其他账户」，用学校邮箱重新登录。';

/**
 * Edge's own setting "allow single sign-on for Microsoft personal sites using
 * this profile". A new profile has it on, so Microsoft's login page is handed
 * the personal account signed in to Windows and the school login fails with
 * AADSTS50020. Turned off in this profile only (the folder belongs to the
 * panel); the student's everyday Edge is not touched. Keeps everything else
 * in the file.
 */
export function turnOffPersonalSso(dir) {
  const file = join(dir, 'Default', 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A new profile: Edge fills in the rest on first start.
  }
  if (prefs?.edge?.msa_sso_info?.allow_for_non_msa_profile === false) return;
  prefs.edge ??= {};
  prefs.edge.msa_sso_info = { ...prefs.edge.msa_sso_info, allow_for_non_msa_profile: false };
  mkdirSync(join(dir, 'Default'), { recursive: true });
  writeFileSync(file, JSON.stringify(prefs));
}

export function cookieHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Opens the browser at `baseUrl`, waits for a signed-in session, and returns
 * `{ cookie, userAgent }` once `validate(cookie, userAgent)` accepts it.
 * `onStatus` receives short progress messages for the UI.
 */
export async function captureSession({ baseUrl, validate, onStatus = () => {}, timeoutMs = TIMEOUT_MS, silent = false, signal }) {
  const exe = findBrowser();
  if (!exe) throw new Error('没有找到 Edge 或 Chrome 浏览器。请改用"手动粘贴"方式登录。');

  const dir = profileDir();
  mkdirSync(dir, { recursive: true });
  const portFile = join(dir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });
  // Edge turns it back on while running, so it is set again before every start.
  turnOffPersonalSso(dir);

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
  // 退出登录 stops a renewal under way: the window closes at once.
  const stopped = () => Object.assign(new Error('登录已取消。'), { code: 'CANCELLED' });
  const kill = () => { try { child.kill(); } catch {} };
  signal?.addEventListener('abort', kill, { once: true });

  onStatus('已打开浏览器窗口，请在里面登录学校账号…');

  // The browser writes its debugging port to this file once it is listening.
  const deadline = Date.now() + timeoutMs;
  let wsUrl;
  while (!wsUrl) {
    if (signal?.aborted) throw stopped();
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
    let signInSince; // when the hidden window landed on a sign-in page
    let wrongShown = false; // the page has been told about a wrong-account error
    while (Date.now() < deadline) {
      if (signal?.aborted) throw stopped();
      if (silent) {
        if (onSignInPage(await pageUrl(cdp), host)) {
          signInSince ??= Date.now();
          if (Date.now() - signInSince >= SIGN_IN_STUCK_MS) {
            throw Object.assign(new Error('学校的登录已失效，需要重新连接。'), { code: 'SIGN_IN_NEEDED' });
          }
        } else {
          signInSince = undefined;
        }
      }
      if (!silent) {
        const wrong = await showsWrongAccount(cdp);
        if (wrong !== wrongShown) {
          wrongShown = wrong;
          onStatus(wrong ? WRONG_ACCOUNT_TEXT : '已打开浏览器窗口，请在里面完成登录…', { wrongAccount: wrong });
        }
      }
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
    signal?.removeEventListener('abort', kill);
    // A silent window that gave up is closed straight away, so it never lingers.
    if (silent && !exited) await cdp.send('Browser.close').catch(() => {});
    cdp.close();
    if (!exited) setTimeout(kill, 3000).unref();
  }
}
