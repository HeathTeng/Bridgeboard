// Bridgeboard: a local web dashboard for Blackboard Learn Ultra.
// Listens on 127.0.0.1 only, so nothing on your network can reach it.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import * as bb from './lib/bb.js';
import { toIcs } from './lib/ics.js';
import { demoChecklist, demoDownload, demoFiles, demoMessages, demoOverview, demoStatus, demoThread } from './lib/demo.js';
import { alreadyThere, planPaths } from './lib/downloader.js';
import { checkDownloadDir, checkDurations, loadSettings, saveSettings } from './lib/settings.js';
import { durations } from './lib/status.js';
import { hasFailures } from './lib/read-state.js';
import { checkDisplay, displayOf } from './lib/display.js';
import { ChecklistStore } from './lib/checklist.js';
import { PushService } from './lib/push-service.js';
import { SENT_FILE } from './lib/push.js';
import { autostartStatus, setAutostart, supported as autostartSupported } from './lib/autostart.js';
import { guideStore } from './lib/guide-state.js';
import { canPick, pickFolder } from './lib/pick-folder.js';
import { serverOs, wordsFor } from './lib/os-words.js';

const DEMO = process.argv.includes('--demo');
// Started by 开机自动启动: minimised, no browser window.
const BACKGROUND = process.argv.includes('--background');
// 'windows' or 'mac' (or 'other'): the page words its reminders for it. --os=mac previews the Mac words on Windows.
const OS = serverOs(process.platform, process.argv);
const WORDS = wordsFor(OS);
const APP_DIR = import.meta.dirname;
const VERSION = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version;
// The app id keeps the old name so a copy of an older version still running is recognised.
const APP_ID = 'blackboard-study-hub';
const PORT = Number(process.env.PORT ?? 3100);
const HOST = '127.0.0.1';
const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
// Rules the page and the server share, served from lib/.
const SHARED = new Set(['status.js', 'checklist-rows.js', 'message-view.js', 'display.js', 'terms.js', 'section-summary.js', 'glossary.js', 'faq.js', 'tour.js', 'ignore.js', 'startup.js', 'read-state.js', 'os-words.js', 'grade-view.js']);
// The only files from docs/ the page may read: the guide's screenshots. The FAQ text comes from /api/faq.
const GUIDE_IMAGES = new Map([['/guide-img/connect.png', 'step-connect.png'], ['/guide-img/download.png', 'step-download.png']]);
const DOCS = join(APP_DIR, 'docs');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// The checklist is local data; demo mode keeps it in memory and writes nothing.
const checklist = DEMO ? new ChecklistStore(null, demoChecklist()) : new ChecklistStore();

// Demo mode keeps the deadline timeline in memory instead of settings.json.
let demoDurations = durations();
let demoDisplay = displayOf();

// The first-run guide shows until it is finished or skipped once; the spotlight tour is offered once after the first sign-in.
const guide = guideStore({ demo: DEMO });
const tour = guideStore({ key: 'tourSeen', demo: DEMO });

// Blackboard is slow across many courses; reuse a result for a few minutes.
let cache;

// One browser sign-in at a time; the page polls GET /api/connect for progress.
let connectJob = { state: 'idle' };
const CACHE_MS = 5 * 60 * 1000;

async function withSession(fn) {
  try {
    return await fn();
  } catch (err) {
    // Expired mid-use: try the saved school login once before asking the user.
    if (!['NOT_AUTHENTICATED', 'SESSION_EXPIRED'].includes(err.code)) throw err;
    bb.resetClient();
    if (!(await bb.renewSilently())) throw err;
    return fn();
  }
}

/**
 * One read at a time: when the page gives up waiting and asks again, the
 * second request waits for the read already under way instead of starting
 * another round of requests to Blackboard.
 */
function shared(fn) {
  let running;
  return () => {
    running ??= fn().finally(() => { running = undefined; });
    return running;
  };
}

const readOverview = shared(async () => {
  const data = await withSession(() => bb.overview());
  // A read with failures is not kept: the next request (重新读取) asks Blackboard again.
  cache = hasFailures(data) ? undefined : { at: Date.now(), data };
  return data;
});

async function getOverview(force) {
  if (DEMO) return demoOverview();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  return readOverview();
}

// Messages are one request per course; cache the thread list like the overview.
let messagesCache;

const readMessages = shared(async () => {
  const data = await withSession(() => bb.messageThreads());
  messagesCache = hasFailures(data) ? undefined : { at: Date.now(), data };
  return data;
});

async function getMessages(force) {
  if (DEMO) return demoMessages();
  if (!force && messagesCache && Date.now() - messagesCache.at < CACHE_MS) return messagesCache.data;
  return readMessages();
}

// Phone alerts. Demo mode keeps the settings in memory and never sends.
let demoPush;
const push = new PushService({
  demo: DEMO,
  load: () => (DEMO ? demoPush : loadSettings().push),
  save: (p) => (DEMO ? (demoPush = p) : saveSettings({ push: p })),
  timeline: () => (DEMO ? demoDurations : durations(loadSettings())),
  ignored: () => checklist.list().ignored,
  getOverview: () => getOverview(false),
  getMessages: () => getMessages(false),
  sentFile: DEMO ? null : SENT_FILE,
});

function pushView(view = push.view()) {
  // Mac has no 开机自动启动 yet: the page shows a note instead of the switch.
  if (OS === 'mac') return { ...view, autostart: { supported: false, on: false, mac: true } };
  const autostart = DEMO ? { supported: autostartSupported(), on: false } : autostartStatus(APP_DIR);
  return { ...view, autostart };
}

/** The phone-alert routes. Only the test and the checker send anything, and only when switched on. */
async function pushRoute(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/push') return send(res, 200, pushView());
  if (route === 'POST /api/push') return send(res, 200, pushView(push.update(await readJson(req))));
  if (route === 'POST /api/push/test') return send(res, 200, pushView(await push.test(await readJson(req))));
  if (route === 'POST /api/push/trial') return send(res, 200, { ...(await push.trial(await readJson(req))), demo: DEMO });
  if (route === 'GET /api/push/topic') return send(res, 200, push.topic());
  if (route === 'POST /api/push/topic') return send(res, 200, pushView(push.changeTopic()));
  if (route === 'POST /api/push/check') {
    if (!push.push().enabled) return send(res, 400, { error: '请先打开手机提醒。' });
    await push.check();
    return send(res, 200, pushView());
  }
  if (route === 'POST /api/push/autostart') {
    if (DEMO) return send(res, 400, { error: '示例模式不会改开机启动。' });
    const { on } = await readJson(req);
    setAutostart(on === true, APP_DIR);
    return send(res, 200, pushView());
  }
  return send(res, 404, { error: 'not found' });
}

// Walking a course's content tree takes many requests; cache each course too.
const fileCache = new Map();

async function getFiles(courseId, force) {
  if (DEMO) return demoFiles(courseId);
  const hit = fileCache.get(courseId);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await withSession(() => bb.courseFiles(courseId)).catch((err) => {
    if (err.code !== 'FORBIDDEN') throw err;
    throw Object.assign(new Error('这门课的内容没有对你开放（考试课程或已结课的课程常见），没有文件可以下载。'), { status: 403 });
  });
  fileCache.set(courseId, { at: Date.now(), data });
  return data;
}

/** Each listed file with the path it would be saved to (when a folder is chosen). */
async function filesWithPaths(courseId, force) {
  const { course, files } = await getFiles(courseId, force);
  const dir = loadSettings().downloadDir;
  if (DEMO || !dir) return { course, files: files.map((file) => ({ file })) };
  const { safeFileName } = await bb.loadLibrary();
  const paths = planPaths(dir, course, files, safeFileName);
  return { course, files: files.map((file, i) => ({ file, path: paths[i] })) };
}

// One download run at a time; the page polls GET /api/download for progress.
let downloadJob = { state: 'idle' };
let stopRequested = false;

async function startDownload(items, exportText) {
  const dir = DEMO ? undefined : checkDownloadDir(loadSettings().downloadDir);
  const byCourse = new Map();
  for (const item of items) {
    if (!byCourse.has(item.courseId)) byCourse.set(item.courseId, new Set());
    byCourse.get(item.courseId).add(String(item.id));
  }
  // Only files the server itself listed can be downloaded: the page sends ids, never URLs.
  const plan = [];
  for (const [courseId, ids] of byCourse) {
    const { files } = await filesWithPaths(courseId, false);
    for (const entry of files) if (ids.has(entry.file.id)) plan.push(entry);
  }
  if (!plan.length) throw Object.assign(new Error('没有找到选中的文件，请刷新列表后重试。'), { status: 400 });

  stopRequested = false;
  downloadJob = { state: 'running', index: 0, total: plan.length, name: '', dir };
  const options = {
    exportText,
    onProgress: (p) => { downloadJob = { ...downloadJob, ...p }; },
    shouldStop: () => stopRequested,
  };
  const run = DEMO ? demoDownload(plan.map((e) => e.file), options) : bb.downloadAll(plan, options);
  run
    .then((result) => { downloadJob = { state: 'done', total: plan.length, dir, result }; })
    .catch((err) => { downloadJob = { state: 'error', dir, message: err.message }; });
  return downloadJob;
}

let picking = false;

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req, 64 * 1024)) || '{}') ?? {};
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(new Error('收到的数据格式不对，请刷新页面再试。'), { status: 400 });
  }
}

async function readBody(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('内容太长'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = createServer(async (req, res) => {
  // Reject requests addressed to any other host name (DNS rebinding) and
  // cross-site posts, so a web page you visit cannot drive this server.
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden host' });
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) {
    return send(res, 403, { error: 'forbidden origin' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/ping') {
      return send(res, 200, { app: APP_ID, version: VERSION, demo: DEMO, os: OS });
    }
    if (url.pathname === '/api/push' || url.pathname.startsWith('/api/push/')) return await pushRoute(req, res, url);
    if (url.pathname === '/api/status') {
      return send(res, 200, DEMO ? demoStatus : await bb.status());
    }
    if (url.pathname === '/api/overview') {
      return send(res, 200, await getOverview(url.searchParams.has('refresh')));
    }
    if (url.pathname === '/calendar.ics') {
      const { todo, failed } = await getOverview(false);
      if (failed?.todo) return send(res, 503, { error: '这次没读到 Blackboard 的截止日期，过一会儿再导出。' });
      return send(res, 200, toIcs(todo), 'text/calendar; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="blackboard-deadlines.ics"',
      });
    }
    if (url.pathname === '/api/messages' && req.method === 'GET') {
      return send(res, 200, await getMessages(url.searchParams.has('refresh')));
    }
    const threadRoute = /^\/api\/messages\/(_\d+_\d+)\/([\w-]{1,64})$/.exec(url.pathname);
    if (threadRoute && req.method === 'GET') {
      const [, courseId, threadId] = threadRoute;
      return send(res, 200, DEMO ? demoThread(courseId, threadId) : await withSession(() => bb.messageThread(courseId, threadId)));
    }
    if (url.pathname === '/api/faq' && req.method === 'GET') {
      return send(res, 200, { text: await readFile(join(DOCS, 'FAQ.md'), 'utf8') });
    }
    if (GUIDE_IMAGES.has(url.pathname) && req.method === 'GET') {
      return send(res, 200, await readFile(join(DOCS, GUIDE_IMAGES.get(url.pathname))), 'image/png');
    }
    if (url.pathname === '/api/config') {
      return send(res, 200, { demo: DEMO, baseUrl: DEMO ? 'https://demo.blackboard.com' : await bb.savedBaseUrl() });
    }
    if (url.pathname === '/api/connect' && req.method === 'GET') {
      return send(res, 200, connectJob);
    }
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      if (DEMO) return send(res, 400, { error: '示例模式下不需要登录。' });
      if (connectJob.state === 'running') return send(res, 409, { error: '已经有一个登录窗口在进行中。' });
      const { url: baseUrl } = JSON.parse(await readBody(req));
      if (!baseUrl) return send(res, 400, { error: '请先填写学校的 Blackboard 网址。' });
      connectJob = { state: 'running', message: '正在打开浏览器…' };
      bb.connectWithBrowser(baseUrl, (message, { wrongAccount = false } = {}) => { connectJob = { state: 'running', message, wrongAccount }; })
        .then(async () => {
          cache = undefined;
          const s = await bb.status();
          connectJob = { state: 'done', message: `登录成功：${s.name ?? ''}` };
        })
        .catch((err) => { connectJob = { state: 'error', message: err.message, hint: err.hint }; });
      return send(res, 202, connectJob);
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (DEMO) return send(res, 400, { error: '示例模式下不需要登录。' });
      const { curl, url: baseUrl } = JSON.parse(await readBody(req));
      if (!curl || typeof curl !== 'string') return send(res, 400, { error: '没有收到粘贴的内容。' });
      await bb.loginWithCurl(curl, baseUrl || undefined);
      cache = undefined;
      return send(res, 200, await bb.status());
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      if (DEMO) return send(res, 400, { error: '示例模式没有登录，不需要退出。' });
      if (connectJob.state === 'running') return send(res, 409, { error: '登录窗口还开着。先把它登录完或关掉，再退出。' });
      if (downloadJob.state === 'running') return send(res, 409, { error: '课程文件还在下载。等下载完，或在「课程文件」里点「停止」后再退出。' });
      await bb.signOut();
      cache = undefined;
      messagesCache = undefined;
      fileCache.clear();
      connectJob = { state: 'idle' };
      return send(res, 200, { signedOut: true });
    }
    const filesRoute = /^\/api\/courses\/(_\d+_\d+)\/files$/.exec(url.pathname);
    if (filesRoute && req.method === 'GET') {
      const { course, files } = await filesWithPaths(filesRoute[1], url.searchParams.has('refresh'));
      return send(res, 200, {
        course,
        files: files.map(({ file, path }) => ({
          id: file.id,
          name: file.name,
          folder: file.folders.join(' / '),
          size: file.size,
          external: Boolean(file.external),
          downloaded: DEMO ? Boolean(file.downloaded) : Boolean(path && alreadyThere(path, file.size)),
        })),
      });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      if (DEMO) return send(res, 200, { downloadDir: WORDS.folderExample, canPick: false, demo: true, ...demoDurations, display: demoDisplay, guideSeen: guide.seen(), tourSeen: tour.seen() });
      const saved = loadSettings();
      return send(res, 200, {
        downloadDir: saved.downloadDir ?? '',
        canPick: canPick(),
        ...durations(saved),
        display: displayOf(saved.display),
        guideSeen: guide.seen(),
        tourSeen: tour.seen(),
      });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      // Finished or skipped the guide or the tour: only true can be saved; 帮助 opens them again any time.
      if ('guideSeen' in body || 'tourSeen' in body) {
        const flags = { guideSeen: guide, tourSeen: tour };
        const keys = Object.keys(body).filter((k) => k in flags);
        if (keys.length !== Object.keys(body).length || keys.some((k) => body[k] !== true)) {
          return send(res, 400, { error: '收到的数据格式不对，请刷新页面再试。' });
        }
        for (const k of keys) flags[k].markSeen();
        return send(res, 200, { guideSeen: guide.seen(), tourSeen: tour.seen() });
      }
      // Display settings and the deadline timeline are saved on their own, and work in demo mode too.
      if ('display' in body) {
        const display = checkDisplay(body.display);
        if (DEMO) return send(res, 200, { display: (demoDisplay = display) });
        return send(res, 200, { display: displayOf(saveSettings({ display }).display) });
      }
      if ('newHours' in body || 'dueSoonHours' in body) {
        const picked = checkDurations(body);
        if (DEMO) return send(res, 200, (demoDurations = picked));
        return send(res, 200, durations(saveSettings(picked)));
      }
      if (DEMO) return send(res, 400, { error: '示例模式不会保存文件，保存位置只是示例。' });
      return send(res, 200, saveSettings({ downloadDir: checkDownloadDir(body.downloadDir) }));
    }
    if (DEMO && url.pathname === '/api/pick-folder' && req.method === 'POST') {
      return send(res, 400, { error: '示例模式不会保存文件，保存位置只是示例。' });
    }
    if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
      if (!canPick()) return send(res, 400, { error: '这台电脑不支持弹出选择窗口，请直接输入文件夹路径。' });
      if (picking) return send(res, 409, { error: '选择文件夹的窗口已经打开了，可能在其他窗口后面。' });
      picking = true;
      try {
        const chosen = await pickFolder(loadSettings().downloadDir);
        if (!chosen) return send(res, 200, { downloadDir: null });
        return send(res, 200, saveSettings({ downloadDir: checkDownloadDir(chosen) }));
      } finally {
        picking = false;
      }
    }
    if (url.pathname === '/api/download' && req.method === 'GET') {
      return send(res, 200, downloadJob);
    }
    if (url.pathname === '/api/download' && req.method === 'POST') {
      if (downloadJob.state === 'running') return send(res, 409, { error: '已经有下载在进行中。' });
      const { items, exportText } = JSON.parse(await readBody(req));
      if (!Array.isArray(items) || !items.length) return send(res, 400, { error: '请先勾选要下载的文件。' });
      return send(res, 202, await startDownload(items, Boolean(exportText)));
    }
    if (url.pathname === '/api/download/stop' && req.method === 'POST') {
      stopRequested = true;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/open-folder' && req.method === 'POST') {
      if (DEMO) return send(res, 400, { error: '示例模式不会真的保存文件，所以没有文件夹可以打开。' });
      const dir = checkDownloadDir(loadSettings().downloadDir);
      const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      execFile(opener, [dir], () => {});
      return send(res, 200, { ok: true });
    }
    // Awaited so its errors reach the catch below instead of crashing the server.
    if (url.pathname.startsWith('/api/checklist')) return await checklistRoute(req, res, url);
    if (req.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^[\w.-]+$/.test(file)) return send(res, 404, 'Not found', 'text/plain');
      // The status rules are shared with the server, so the page loads them from lib/.
      const dir = SHARED.has(file) ? join(import.meta.dirname, 'lib') : PUBLIC;
      const body = await readFile(join(dir, file)).catch(() => null);
      if (!body) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, body, TYPES[extname(file)] ?? 'application/octet-stream');
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, err.status ?? 500, { error: err.message, code: err.code, hint: err.hint });
  }
});

/** The checklist routes. Local file only: none of them touches Blackboard. */
async function checklistRoute(req, res, url) {
  const { pathname } = url;
  const m = req.method;
  if (pathname === '/api/checklist' && m === 'GET') return send(res, 200, checklist.list());
  if (pathname === '/api/checklist/items' && m === 'POST') return send(res, 201, checklist.add(await readJson(req)));
  if (pathname === '/api/checklist/clear-done' && m === 'POST') return send(res, 200, checklist.clearDone((await readJson(req)).ids));
  const item = /^\/api\/checklist\/items\/([\w-]{1,64})$/.exec(pathname);
  if (item && m === 'PATCH') return send(res, 200, checklist.update(item[1], await readJson(req)));
  if (item && m === 'DELETE') return send(res, 200, checklist.remove(item[1]));
  // 忽略: an overdue assignment the student no longer wants reminders for. Local only.
  const ign = /^\/api\/checklist\/ignored\/([^/]+)$/.exec(pathname);
  if (ign && m === 'PUT') {
    let key = '';
    try {
      key = decodeURIComponent(ign[1]);
    } catch {}
    return send(res, 200, checklist.ignore(key, (await readJson(req)).ignored));
  }
  const mark = /^\/api\/checklist\/marks\/([^/]+)$/.exec(pathname);
  if (mark && m === 'PUT') {
    let key = '';
    try {
      key = decodeURIComponent(mark[1]);
    } catch {}
    return send(res, 200, checklist.mark(key, (await readJson(req)).done));
  }
  return send(res, 404, { error: '找不到这条事项，可能已经被删除了。请刷新页面。' });
}

const link = `http://localhost:${PORT}`;

function openPage() {
  if (process.argv.includes('--no-open') || BACKGROUND) return;
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(cmd, () => {});
}

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Probably the hub is already running (e.g. started with Windows): just open the page.
  const running = await fetch(`${link}/api/ping`, { signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (running?.app === APP_ID && running.demo === DEMO) {
    // Exit code 0 lets start.bat / start.command close this extra window by itself.
    if (!BACKGROUND) console.log(`\n面板已经在运行，已为你打开：${link}\n`);
    openPage();
    return;
  }
  if (running?.app === APP_ID) {
    console.log(`\n面板已经在以${running.demo ? '示例模式' : '真实数据'}运行：${link}`);
    const autostarted = OS === 'windows' ? '（开机自动启动的那个最小化在任务栏里）' : '';
    console.log(`想切换的话，请先关掉之前的${WORDS.window}${autostarted}，再重新双击。\n`);
  } else {
    console.log(`\n端口 ${PORT} 被其他程序占用了。可以关掉占用它的程序后重试。\n`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`\nBridgeboard ${DEMO ? '(示例模式) ' : ''}已启动：${link}`);
  console.log('关闭这个窗口即可停止。\n');
  if (BACKGROUND) console.log(`这是开机自动启动的后台窗口，手机提醒会照常检查。要看面板，双击 ${WORDS.launcher} 或在浏览器打开上面的网址。\n`);
  openPage();
  push.start();
});
