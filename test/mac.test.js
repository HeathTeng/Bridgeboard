// The Mac version (trial): the launchers, the zip, and the places where the
// page words things differently on a Mac. What only a real Mac can show is
// listed in docs/dev/mac.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { OSES, WORDS, osOf, serverOs, wordsFor } from '../lib/os-words.js';
import { MAC_PICK_FOLDER, canPick, pickCommand, pickFolder } from '../lib/pick-folder.js';
import { NO_BROWSER_TEXT, browserCandidates, findBrowser } from '../lib/edge-login.js';
import { checkDownloadDir } from '../lib/settings.js';
import { stuckText } from '../lib/startup.js';
import { parseFaq } from '../lib/faq.js';
import { GUIDE_PAGES, useGuideOs } from '../public/guide.js';

const ROOT = join(import.meta.dirname, '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

// ---- start.command: which Node.js it picks ----

/** bash: Git Bash on Windows (skipped when missing), else the one on PATH. */
function findBash() {
  if (process.platform !== 'win32') return 'bash';
  const git = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return existsSync(git) ? git : null;
}
const BASH = findBash();

/** A pretend Bridgeboard folder (spaces and Chinese in the path) with fake sysctl, uname, xattr and Node.js. */
function fakeMac({ runtime = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'bb-mac-'));
  const app = join(base, 'Bridgeboard 下载 v1');
  const bin = join(base, 'bin');
  mkdirSync(join(app, 'runtime'), { recursive: true });
  mkdirSync(bin);
  for (const f of ['start.command', 'demo.command']) copyFileSync(join(ROOT, f), join(app, f));
  const script = (path, body) => {
    writeFileSync(path, `#!/bin/bash\n${body}\n`);
    chmodSync(path, 0o755);
  };
  if (runtime) {
    for (const arch of ['arm64', 'x64']) {
      script(join(app, 'runtime', `node-${arch}`), `[ "$1" = --version ] && exit 0\necho "node=${arch} dir=\${PWD##*/} args=$*"\nexit \${FAKE_EXIT:-0}`);
    }
  }
  script(join(bin, 'sysctl'), 'echo "$FAKE_ARM64"');
  script(join(bin, 'uname'), 'echo "$FAKE_UNAME"');
  script(join(bin, 'xattr'), 'echo "$*" >> "$XATTR_LOG"\n[ "$1" = -p ] && [ "$FAKE_QUARANTINE" = 1 ] && exit 0\n[ "$1" = -p ] && exit 1\nexit 0');
  return { base, app, bin, script };
}

function launch(mac, { file = 'start.command', args = [], env = {}, path } = {}) {
  const log = join(mac.base, 'xattr.log');
  rmSync(log, { force: true });
  const r = spawnSync(BASH, [join(mac.app, file).replace(/\\/g, '/'), ...args], {
    encoding: 'utf8',
    input: '\n',
    env: { PATH: path ?? mac.bin, XATTR_LOG: log, FAKE_ARM64: '', FAKE_UNAME: 'x86_64', ...env },
  });
  return { ...r, out: r.stdout + r.stderr, xattr: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('start.command picks the Node.js for the chip, even under Rosetta', { skip: !BASH && 'no bash here' }, () => {
  const mac = fakeMac();
  try {
    assert.match(launch(mac, { env: { FAKE_ARM64: '1', FAKE_UNAME: 'arm64' } }).out, /node=arm64/, 'Apple chip');
    assert.match(launch(mac, { env: { FAKE_ARM64: '1', FAKE_UNAME: 'x86_64' } }).out, /node=arm64/, 'Apple chip, Terminal under Rosetta');
    assert.match(launch(mac, { env: { FAKE_ARM64: '0', FAKE_UNAME: 'x86_64' } }).out, /node=x64/, 'Intel');
    assert.match(launch(mac, { env: { FAKE_ARM64: '', FAKE_UNAME: 'x86_64' } }).out, /node=x64/, 'Intel, older macOS without the sysctl');
    // Git Bash puts its own uname ahead of the fake one; CI (Linux) checks this case.
    if (process.platform !== 'win32') assert.match(launch(mac, { env: { FAKE_ARM64: '', FAKE_UNAME: 'arm64' } }).out, /node=arm64/);
  } finally {
    rmSync(mac.base, { recursive: true, force: true });
  }
});

test('start.command: runs from its own folder (spaces, Chinese), passes options on, exit 0 ends quietly', { skip: !BASH && 'no bash here' }, () => {
  const mac = fakeMac();
  try {
    const plain = launch(mac);
    assert.equal(plain.status, 0);
    assert.match(plain.out, /dir=Bridgeboard 下载 v1 args=server\.js\n/);
    assert.match(plain.out, /可以关掉这个窗口了/);
    assert.match(launch(mac, { args: ['--background'] }).out, /args=server\.js --background/);
    assert.match(launch(mac, { file: 'demo.command' }).out, /node=x64 dir=Bridgeboard 下载 v1 args=server\.js --demo/, 'demo.command is start.command --demo');
    const failed = launch(mac, { env: { FAKE_EXIT: '1' } });
    assert.equal(failed.status, 1, 'an error keeps its exit code');
    assert.match(failed.out, /按回车键关闭/);
    assert.doesNotMatch(failed.out, /可以关掉这个窗口了/);
  } finally {
    rmSync(mac.base, { recursive: true, force: true });
  }
});

test('start.command: Node.js on the Mac when there is no runtime folder, plain Chinese when there is none', { skip: !BASH && 'no bash here' }, () => {
  const mac = fakeMac({ runtime: false });
  try {
    const other = join(mac.base, 'node-bin');
    mkdirSync(other);
    mac.script(join(other, 'node'), 'echo "node=installed args=$*"');
    const sep = process.platform === 'win32' ? ';' : ':';
    assert.match(launch(mac, { path: `${mac.bin}${sep}${other}` }).out, /node=installed args=server\.js/);
    const none = launch(mac);
    assert.equal(none.status, 1);
    assert.match(none.out, /没有找到 Node\.js/);
    assert.match(none.out, /Bridgeboard-Mac\.zip/);
  } finally {
    rmSync(mac.base, { recursive: true, force: true });
  }
});

test('start.command: the "downloaded" mark goes, the first time only, and only in its own folder', { skip: !BASH && 'no bash here' }, () => {
  const mac = fakeMac();
  try {
    const first = launch(mac, { env: { FAKE_QUARANTINE: '1' } });
    const removal = first.xattr.split('\n').filter((l) => l.startsWith('-d'));
    assert.equal(removal.length, 1);
    assert.match(removal[0], /^-dr com\.apple\.quarantine \S.*\/Bridgeboard 下载 v1$/, 'this folder, nothing else');
    assert.match(first.out, /只处理这个文件夹，不碰电脑上其他地方/);
    const later = launch(mac, { env: { FAKE_QUARANTINE: '0' } });
    assert.doesNotMatch(later.xattr, /^-d/m, 'nothing to do the next time');
    assert.doesNotMatch(later.out, /第一次运行/);
  } finally {
    rmSync(mac.base, { recursive: true, force: true });
  }
});

test('the .command files: Unix line endings, bash, "can run" in git, no .bat in them', () => {
  for (const f of ['start.command', 'demo.command']) {
    const text = read(f);
    assert.ok(text.startsWith('#!/bin/bash\n'), f);
    assert.ok(!text.includes('\r'), `${f}: LF only`);
  }
  assert.match(read('.gitattributes'), /^\*\.command text eol=lf$/m);
  const git = spawnSync('git', ['ls-files', '-s', 'start.command', 'demo.command', 'scripts/build-mac.sh'], { cwd: ROOT, encoding: 'utf8' });
  if (git.status === 0 && git.stdout.trim()) {
    for (const line of git.stdout.trim().split('\n')) assert.match(line, /^100755 /, line);
  }
});

// ---- The zip ----

test('the Mac zip: fixed names, both chips, SHA-256 checked, checked again after zipping; Windows untouched', () => {
  const mac = read('scripts/build-mac.sh');
  assert.match(mac, /NAME="Bridgeboard"/);
  // getboundly.com will link to /releases/latest/download/Bridgeboard-Mac.zip: keep this name exactly.
  assert.match(mac, /"\$OUT\/\$NAME-\$VERSION-mac\.zip"/);
  assert.match(mac, /cp "\$OUT\/\$NAME-\$VERSION-mac\.zip" "\$OUT\/\$NAME-Mac\.zip"/);
  assert.match(mac, /for ARCH in arm64 x64/);
  assert.match(mac, /node-\$NODE_VERSION-darwin-\$ARCH\.tar\.gz/);
  assert.match(mac, /sha256sum -c -/);
  assert.match(mac, /runtime\/node-\$ARCH"/);
  assert.match(mac, /start\.command,demo\.command/);
  assert.doesNotMatch(mac, /\.bat,|start\.bat|demo\.bat/, 'no .bat in the Mac zip');
  assert.match(mac, /\[ -x "\$CHECK\/\$NAME\/\$f" \]/, 'permissions checked after unzipping');
  assert.match(mac, /HOW-TO-USE\.txt/);
  assert.match(mac, /仍要打开/);
  assert.match(mac, /合上盖子时不会发提醒/);
  // The Windows zip keeps its names and contents.
  const win = read('scripts/build-portable.sh');
  assert.match(win, /zip -qr "\$NAME-\$VERSION-windows\.zip" "\$NAME"/);
  assert.match(win, /cp "\$OUT\/\$NAME-\$VERSION-windows\.zip" "\$OUT\/\$NAME-Windows\.zip"/);
  assert.match(win, /start\.bat,demo\.bat/);
  assert.doesNotMatch(win, /\.command/);
  // The workflow builds Windows first (it empties dist/), then Mac, and says the Mac one is a trial.
  const wf = read('.github/workflows/release.yml');
  assert.ok(wf.indexOf('build-portable.sh') < wf.indexOf('build-mac.sh'));
  assert.match(wf, /Mac 版是试用版/);
  assert.match(wf, /runs-on: ubuntu-latest/);
});

// ---- Words for each system ----

test('os words: the system from Node, --os only for previews, the same things named on both', () => {
  assert.equal(osOf('win32'), 'windows');
  assert.equal(osOf('darwin'), 'mac');
  assert.equal(osOf('linux'), 'other');
  assert.equal(serverOs('win32', ['server.js', '--demo', '--os=mac']), 'mac');
  assert.equal(serverOs('darwin', ['--os=nonsense']), 'mac');
  assert.deepEqual(OSES, ['windows', 'mac']);
  assert.deepEqual(Object.keys(WORDS.mac), Object.keys(WORDS.windows));
  assert.equal(wordsFor('mac').window, '终端窗口');
  assert.equal(wordsFor('windows').window, '黑色窗口');
  assert.equal(wordsFor('other'), WORDS.windows);
  assert.equal(wordsFor('mac').launcher, 'start.command');
  assert.match(stuckText(wordsFor('mac').window), /等待期间终端窗口不要关/);
});

test('guide page 2 and FAQ 第一条: the same rule, in the words of each system', () => {
  const first = parseFaq(read('docs/FAQ.md')).groups[0].questions[0].title;
  assert.equal(first, '只有电脑开着、黑色窗口（Mac 上是终端窗口）开着才会发提醒');
  const page = () => GUIDE_PAGES.find((p) => p.id === 'keep-open');
  try {
    useGuideOs('mac');
    const mac = page().lines;
    useGuideOs('windows');
    const win = page().lines;
    assert.equal(mac.length, win.length);
    assert.ok(win[0].startsWith(first.replace('（Mac 上是终端窗口）', '')), win[0]);
    assert.ok(mac[0].startsWith(first.replace('黑色窗口（Mac 上是终端窗口）', '终端窗口')), mac[0]);
    assert.doesNotMatch(mac.join(''), /黑色窗口|✕|start\.bat/);
    assert.doesNotMatch(win.join(''), /终端/);
    assert.match(mac.join(''), /合上盖子/);
  } finally {
    useGuideOs('windows');
  }
});

test('no Windows-only words left in page scripts (they come from os-words)', () => {
  for (const f of ['public/app.js', 'public/push.js', 'public/ui.js', 'public/layout.js', 'public/help.js']) {
    const code = read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    assert.doesNotMatch(code, /黑色窗口|start\.bat|Windows 版本|Ctrl\+C/, f);
  }
  const html = read('public/index.html').replace(/<span class="os-win">[^<]*<\/span>/g, '');
  // Windows words in index.html are in .os-win spans, or in the Windows-only 开机自动启动 box.
  const outside = html.replace(/<fieldset id="autostartBox"[\s\S]*?<\/fieldset>/, '');
  assert.doesNotMatch(outside, /黑色窗口|start\.bat/);
});

// ---- 开机自动启动, 选择文件夹, the sign-in browser ----

test('Mac: no 开机自动启动 switch, a note instead (the server says so, the page shows it)', async () => {
  const html = read('public/index.html');
  const box = html.match(/<fieldset id="autostartMac"[^>]*hidden>([\s\S]*?)<\/fieldset>/);
  assert.ok(box, 'a hidden box of its own');
  assert.doesNotMatch(box[1], /<input/, 'no switch');
  assert.match(box[1], /<p class="alert">Mac 版暂时不能开机自动启动，要收提醒请保持终端窗口开着。电脑睡眠或合上盖子时不会发提醒。<\/p>/);
  assert.match(read('public/push.js'), /\$\('autostartMac'\)\.hidden = !a\.mac;/);

  // The real server in demo mode, once with the Mac words and once without.
  for (const [os, port] of [['mac', 3197], ['windows', 3198]]) {
    const child = spawn(process.execPath, ['server.js', '--demo', '--no-open', `--os=${os}`], { cwd: ROOT, env: { ...process.env, PORT: String(port) } });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', (d) => /已启动/.test(String(d)) && resolve());
        child.on('exit', () => reject(new Error('server stopped')));
      });
      const get = (path) => fetch(`http://127.0.0.1:${port}${path}`).then((r) => r.json());
      assert.equal((await get('/api/ping')).os, os);
      const autostart = (await get('/api/push')).autostart;
      if (os === 'mac') assert.deepEqual(autostart, { supported: false, on: false, mac: true });
      else assert.ok(!autostart.mac);
      if (os === 'mac') assert.equal((await get('/api/settings')).downloadDir, WORDS.mac.folderExample);
    } finally {
      child.kill();
    }
  }
});

test('选择文件夹 on a Mac: osascript choose folder, the start folder as an argument, cancel changes nothing', async () => {
  assert.equal(canPick('darwin'), true);
  assert.equal(canPick('win32'), true);
  assert.equal(canPick('linux'), false);

  const calls = [];
  const fake = (result) => (file, args, options, cb) => {
    calls.push({ file, args, options });
    cb(...result);
  };
  const home = homedir();
  assert.equal(await pickFolder(home, { platform: 'darwin', run: fake([null, '/Users/me/课程 资料/\n', '']) }), '/Users/me/课程 资料');
  assert.equal(calls[0].file, 'osascript');
  assert.equal(calls[0].args.at(-1), home, 'the folder it starts in, as an argument');
  assert.deepEqual(calls[0].args.slice(0, -1).filter((a) => a !== '-e'), MAC_PICK_FOLDER);
  assert.ok(MAC_PICK_FOLDER.some((l) => /choose folder/.test(l)));
  assert.ok(!MAC_PICK_FOLDER.join('\n').includes(home), 'never pasted into the script');

  // Cancelled: AppleScript error -128.
  const cancel = Object.assign(new Error('Command failed'), { code: 1 });
  assert.equal(await pickFolder('', { platform: 'darwin', run: fake([cancel, '', '0:1: execution error: User canceled. (-128)']) }), null);
  // A folder that is gone: start without one.
  assert.equal(pickCommand('darwin', join(home, 'no-such-folder-bb')).at(1).at(-1), '');
  // Other failures are errors.
  await assert.rejects(pickFolder('', { platform: 'darwin', run: fake([cancel, '', 'something else']) }));

  // Windows: still PowerShell, the start folder in an environment variable.
  calls.length = 0;
  assert.equal(await pickFolder(home, { platform: 'win32', run: fake([null, 'E:\\课程资料\r\n', '']) }), 'E:\\课程资料');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.equal(calls[0].options.env.BBHUB_START, home);
  assert.equal(await pickFolder('', { platform: 'win32', run: fake([null, '', '']) }), null, 'closed without choosing');
});

test('保存位置 on a Mac: ~/ works, the example is a Mac path', () => {
  assert.equal(checkDownloadDir('~', 'darwin'), homedir());
  assert.throws(() => checkDownloadDir('课程资料', 'darwin'), /例如 \/Users\/你的名字\/课程资料/);
  assert.throws(() => checkDownloadDir('课程资料', 'win32'), /例如 E:\\课程资料/);
});

test('sign-in browser on a Mac: /Applications and ~/Applications, Edge first; plain words when none', () => {
  const list = browserCandidates('darwin', {}, '/Users/me');
  assert.deepEqual(list, [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Users/me/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Users/me/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]);
  const only = (path) => (p) => p === path;
  assert.equal(findBrowser({ platform: 'darwin', env: {}, home: '/Users/me', exists: only(list[1]) }), list[1]);
  assert.equal(findBrowser({ platform: 'darwin', env: {}, home: '/Users/me', exists: () => false }), undefined);
  assert.match(NO_BROWSER_TEXT, /请先安装其中一个/);
  assert.match(read('lib/edge-login.js'), /process\.platform === 'darwin' \? \['--use-mock-keychain'\]/);
});

test('file names: characters a Mac or Windows refuses are replaced (the library rule covers ":")', () => {
  const unsafe = read('vendor/blackboard-mcp.js').match(/var UNSAFE = (\/.*\/g);/);
  assert.ok(unsafe);
  const rule = new Function(`return ${unsafe[1]}`)();
  assert.equal('Week 1: Intro/Notes'.replace(rule, '_'), 'Week 1_ Intro_Notes');
});
