// The student's choices that should survive a restart, such as the download
// folder. Kept in ~/.blackboard-study-hub/settings.json next to the browser profile.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { LIMITS } from './status.js';

const DIR = join(homedir(), '.blackboard-study-hub');
const FILE = join(DIR, 'settings.json');

export function loadSettings() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return next;
}

/**
 * Checks a download folder the page sent: it must be an absolute path that
 * exists as a folder or can be created. Returns the resolved path.
 */
export function checkDownloadDir(dir) {
  if (typeof dir !== 'string' || !dir.trim()) throw badDir('请先选择保存文件的文件夹。');
  const path = dir.trim();
  if (!isAbsolute(path) || (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(path))) {
    throw badDir('文件夹需要是完整路径，例如 E:\\课程资料。');
  }
  const full = resolve(path);
  if (existsSync(full)) {
    if (!statSync(full).isDirectory()) throw badDir('这个位置是一个文件，不是文件夹。');
    return full;
  }
  try {
    mkdirSync(full, { recursive: true });
  } catch (err) {
    throw badDir(`无法创建这个文件夹：${err.code ?? err.message}`);
  }
  return full;
}

/**
 * Checks the deadline timeline the page sent: "new" is 0 (opened today) or
 * 6-72 hours, "due soon" is 1-72 hours, whole hours only.
 */
export function checkDurations({ newHours, dueSoonHours } = {}) {
  const inRange = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;
  if (!(newHours === 0 || inRange(newHours, LIMITS.newHours)) || !inRange(dueSoonHours, LIMITS.dueSoonHours)) {
    throw badDir('时间轴的设置不对：刚开放要选"当天"或 6 到 72 小时，临期要选 1 到 72 小时。');
  }
  return { newHours, dueSoonHours };
}

function badDir(message) {
  return Object.assign(new Error(message), { status: 400 });
}
