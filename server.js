// blackboard-study-hub: a local web dashboard for Blackboard Learn Ultra.
// Listens on 127.0.0.1 only, so nothing on your network can reach it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import * as bb from './lib/bb.js';
import { toIcs } from './lib/ics.js';
import { demoDownload, demoFiles, demoOverview, demoStatus } from './lib/demo.js';
import { alreadyThere, planPaths } from './lib/downloader.js';
import { checkDownloadDir, loadSettings, saveSettings } from './lib/settings.js';

const DEMO = process.argv.includes('--demo');
const PORT = Number(process.env.PORT ?? 3100);
const HOST = '127.0.0.1';
const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

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

async function getOverview(force) {
  if (DEMO) return demoOverview();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = await withSession(() => bb.overview());
  cache = { at: Date.now(), data };
  return data;
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

// The native Windows folder picker. PowerShell -STA is needed for the dialog;
// a hidden top-most owner window keeps it in front of the browser.
const PICK_FOLDER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择保存课程文件的文件夹（可以选 U 盘）'
$dialog.ShowNewFolderButton = $true
if ($env:BBHUB_START -and (Test-Path -LiteralPath $env:BBHUB_START)) { $dialog.SelectedPath = $env:BBHUB_START }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }
$owner.Dispose()
`;

let picking = false;

function pickFolder(start) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', PICK_FOLDER],
      { env: { ...process.env, BBHUB_START: start ?? '' }, windowsHide: true, timeout: 10 * 60 * 1000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim() || null)),
    );
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
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
    if (url.pathname === '/api/status') {
      return send(res, 200, DEMO ? demoStatus : await bb.status());
    }
    if (url.pathname === '/api/overview') {
      return send(res, 200, await getOverview(url.searchParams.has('refresh')));
    }
    if (url.pathname === '/calendar.ics') {
      const { todo } = await getOverview(false);
      return send(res, 200, toIcs(todo), 'text/calendar; charset=utf-8', {
        'Content-Disposition': 'attachment; filename="blackboard-deadlines.ics"',
      });
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
      bb.connectWithBrowser(baseUrl, (message) => { connectJob = { state: 'running', message }; })
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
      if (DEMO) return send(res, 200, { downloadDir: 'E:\\课程资料', canPick: false, demo: true });
      return send(res, 200, { downloadDir: loadSettings().downloadDir ?? '', canPick: process.platform === 'win32' });
    }
    if (DEMO && ['/api/settings', '/api/pick-folder'].includes(url.pathname) && req.method === 'POST') {
      return send(res, 400, { error: '示例模式不会保存文件，保存位置只是示例。' });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const { downloadDir } = JSON.parse(await readBody(req));
      return send(res, 200, saveSettings({ downloadDir: checkDownloadDir(downloadDir) }));
    }
    if (url.pathname === '/api/pick-folder' && req.method === 'POST') {
      if (process.platform !== 'win32') return send(res, 400, { error: '这台电脑不支持弹出选择窗口，请直接输入文件夹路径。' });
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
    if (req.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!/^[\w.-]+$/.test(file)) return send(res, 404, 'Not found', 'text/plain');
      const body = await readFile(join(PUBLIC, file)).catch(() => null);
      if (!body) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, body, TYPES[extname(file)] ?? 'application/octet-stream');
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    send(res, err.status ?? 500, { error: err.message, code: err.code, hint: err.hint });
  }
});

const link = `http://localhost:${PORT}`;

function openPage() {
  if (process.argv.includes('--no-open')) return;
  const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
  exec(cmd, () => {});
}

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Probably the hub is already running in another window: just open the page.
  const running = await fetch(`${link}/api/status`).then((r) => r.ok).catch(() => false);
  if (running) {
    console.log(`\n面板已经在运行，已为你打开：${link}`);
    console.log('（如果想切换到示例模式或真实数据，请先关掉之前的黑色窗口。）\n');
    openPage();
  } else {
    console.log(`\n端口 ${PORT} 被其他程序占用了。可以关掉占用它的程序后重试。\n`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`\nblackboard-study-hub ${DEMO ? '(示例模式) ' : ''}已启动：${link}`);
  console.log('关闭这个窗口即可停止。\n');
  openPage();
});
