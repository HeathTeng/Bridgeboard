// blackboard-study-hub: a local web dashboard for Blackboard Learn Ultra.
// Listens on 127.0.0.1 only, so nothing on your network can reach it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { exec } from 'node:child_process';
import * as bb from './lib/bb.js';
import { toIcs } from './lib/ics.js';
import { demoOverview, demoStatus } from './lib/demo.js';

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

async function getOverview(force) {
  if (DEMO) return demoOverview();
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  let data;
  try {
    data = await bb.overview();
  } catch (err) {
    // Expired mid-use: try the saved school login once before asking the user.
    if (!['NOT_AUTHENTICATED', 'SESSION_EXPIRED'].includes(err.code)) throw err;
    bb.resetClient();
    if (!(await bb.renewSilently())) throw err;
    data = await bb.overview();
  }
  cache = { at: Date.now(), data };
  return data;
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
