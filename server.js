// blackboard-study-hub: a local web dashboard for Blackboard Learn Ultra.
// Listens on 127.0.0.1 only, so nothing on your network can reach it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { exec, execFile } from 'node:child_process';
import * as bb from './lib/bb.js';
import { toIcs } from './lib/ics.js';
import { demoChecklist, demoDownload, demoFiles, demoMessages, demoOverview, demoStatus, demoThread } from './lib/demo.js';
import { alreadyThere, planPaths } from './lib/downloader.js';
import { checkDownloadDir, checkDurations, loadSettings, saveSettings } from './lib/settings.js';
import { durations } from './lib/status.js';
import { checkDisplay, displayOf } from './lib/display.js';
import { ChecklistStore } from './lib/checklist.js';

const DEMO = process.argv.includes('--demo');
const PORT = Number(process.env.PORT ?? 3100);
const HOST = '127.0.0.1';
const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// Rules the page and the server share, served from lib/.
const SHARED = new Set(['status.js', 'checklist-rows.js', 'message-view.js', 'display.js']);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// The checklist is local data; demo mode keeps it in memory and writes nothing.
const checklist = DEMO ? new ChecklistStore(null, demoChecklist()) : new ChecklistStore();

// Demo mode keeps the deadline timeline in memory instead of settings.json.
let demoDurations = durations();
let demoDisplay = displayOf();

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

// Messages are one request per course; cache the thread list like the overview.
let messagesCache;

async function getMessages(force) {
  if (DEMO) return demoMessages();
  if (!force && messagesCache && Date.now() - messagesCache.at < CACHE_MS) return messagesCache.data;
  const data = await withSession(() => bb.messageThreads());
  messagesCache = { at: Date.now(), data };
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

// The native Windows folder picker: the Explorer-style IFileOpenDialog with
// FOS_PICKFOLDERS, through a few lines of C# compiled by Add-Type (no extra
// dependency). If that fails for any reason, the older FolderBrowserDialog is
// shown instead, so a folder can always be picked; BBHUB_PICKER=classic forces
// it. PowerShell -STA is needed for both; a hidden top-most owner window keeps
// the dialog in front of the browser. Prints the chosen path, or nothing.
const PICK_FOLDER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$title = '选择保存课程文件的文件夹（可以选 U 盘）'
$start = ''
if ($env:BBHUB_START -and (Test-Path -LiteralPath $env:BBHUB_START)) { $start = $env:BBHUB_START }
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$picked = $null
$shown = $false
if ($env:BBHUB_PICKER -ne 'classic') {
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BbHubFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}

  // Methods in vtable order, up to the last one used (GetResult).
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, out IShellItem item);

  private const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  /** The chosen folder, or null if the student cancelled. Throws on any other failure. */
  public static string Pick(IntPtr owner, string title, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialog();
    try {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
      dialog.SetTitle(title);
      if (!String.IsNullOrEmpty(start)) {
        try {
          Guid iid = typeof(IShellItem).GUID;
          IShellItem folder;
          SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
          dialog.SetFolder(folder);
        } catch (Exception) {
          // A folder that has gone away (USB drive unplugged): open at the default place.
        }
      }
      int hr = dialog.Show(owner);
      if (hr == ERROR_CANCELLED) return null;
      Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dialog.GetResult(out item);
      string path;
      item.GetDisplayName(SIGDN_FILESYSPATH, out path);
      return path;
    } finally {
      Marshal.ReleaseComObject(dialog);
    }
  }
}
'@
    $picked = [BbHubFolderPicker]::Pick($owner.Handle, $title, $start)
    $shown = $true
  } catch {
    [Console]::Error.WriteLine("new folder picker failed, using the classic one: $($_.Exception.Message)")
  }
}
if (-not $shown) {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = $title
  $dialog.ShowNewFolderButton = $true
  if ($start) { $dialog.SelectedPath = $start }
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $dialog.SelectedPath }
}
if ($picked) { $picked }
$owner.Dispose()
`;

let picking = false;

function pickFolder(start) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', PICK_FOLDER],
      { env: { ...process.env, BBHUB_START: start ?? '' }, windowsHide: true, timeout: 10 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (stderr.trim()) console.log(stderr.trim());
        return err ? reject(err) : resolve(stdout.trim() || null);
      },
    );
  });
}

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
    if (url.pathname === '/api/messages' && req.method === 'GET') {
      return send(res, 200, await getMessages(url.searchParams.has('refresh')));
    }
    const threadRoute = /^\/api\/messages\/(_\d+_\d+)\/([\w-]{1,64})$/.exec(url.pathname);
    if (threadRoute && req.method === 'GET') {
      const [, courseId, threadId] = threadRoute;
      return send(res, 200, DEMO ? demoThread(courseId, threadId) : await withSession(() => bb.messageThread(courseId, threadId)));
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
      if (DEMO) return send(res, 200, { downloadDir: 'E:\\课程资料', canPick: false, demo: true, ...demoDurations, display: demoDisplay });
      const saved = loadSettings();
      return send(res, 200, {
        downloadDir: saved.downloadDir ?? '',
        canPick: process.platform === 'win32',
        ...durations(saved),
        display: displayOf(saved.display),
      });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
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
