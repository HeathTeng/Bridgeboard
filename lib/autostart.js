// 开机自动启动 (Windows only): a small .cmd in the user's Startup folder that
// starts start.bat minimised with --background (no browser window). A .cmd,
// not a .vbs: Windows is phasing out VBScript and antivirus tools flag it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const NAME = 'blackboard-study-hub.cmd';

export const supported = (platform = process.platform) => platform === 'win32';

/** The Startup folder, from %APPDATA% (which the tests can point elsewhere). */
export function startupDir(env = process.env) {
  return env.APPDATA ? join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') : '';
}

/**
 * The launcher. chcp 65001 first, so a folder name in Chinese survives
 * (the file is UTF-8). If the folder is gone (moved, or a USB drive not
 * plugged in) it quietly does nothing.
 */
export function launcherText(appDir) {
  const bat = join(appDir, 'start.bat');
  return [
    '@echo off',
    'chcp 65001 >nul',
    'rem blackboard-study-hub: starts the dashboard minimised when you sign in to Windows.',
    'rem Turn this off in the dashboard (手机提醒 -> 开机自动启动), or delete this file.',
    `if not exist "${bat}" exit /b`,
    `start "blackboard-study-hub" /min cmd /c ""${bat}" --background"`,
    '',
  ].join('\r\n');
}

/** The app folder a launcher points at, or '' if it cannot be read. */
export function appDirIn(text) {
  return /^if not exist "(.+)[\\/]start\.bat" exit/m.exec(text ?? '')?.[1] ?? '';
}

/**
 * { supported, on, problem }: problem is 'moved' when the launcher points at
 * another folder (this copy was moved, or it is on a USB drive that is not
 * plugged in), 'missing' when that folder is gone.
 */
export function autostartStatus(appDir, { env = process.env, platform = process.platform } = {}) {
  if (!supported(platform) || !startupDir(env)) return { supported: false, on: false };
  const file = join(startupDir(env), NAME);
  if (!existsSync(file)) return { supported: true, on: false };
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {}
  const target = appDirIn(text);
  if (target && resolve(target).toLowerCase() === resolve(appDir).toLowerCase()) return { supported: true, on: true };
  return { supported: true, on: true, problem: target && existsSync(join(target, 'start.bat')) ? 'moved' : 'missing' };
}

/** Turns it on (or fixes it to point at this folder) or off. */
export function setAutostart(on, appDir, { env = process.env, platform = process.platform } = {}) {
  if (!supported(platform) || !startupDir(env)) {
    throw Object.assign(new Error('开机自动启动只支持 Windows。'), { status: 400 });
  }
  const dir = startupDir(env);
  const file = join(dir, NAME);
  if (on) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, launcherText(appDir), 'utf8');
  } else {
    rmSync(file, { force: true });
  }
  return autostartStatus(appDir, { env, platform });
}
