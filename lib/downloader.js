// Where downloaded course files go on disk, and whether they are already there.
// Pure path logic, kept apart from Blackboard so it can be tested on its own.
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

// Windows refuses paths over 260 characters unless long paths are switched on,
// which USB drives and older machines often are not. Leave room for the
// " (1)" a duplicate name gets and the ".txt" of the text export.
const PATH_MAX = 240;
const SEGMENT_MAX = 60;
const FOLDER_MIN = 8;

/** Shortens a name to `max` characters, keeping its extension. */
export function trimName(name, max) {
  if (name.length <= max) return name;
  const ext = extname(name);
  const keepExt = ext.length > 0 && ext.length <= 12 && ext.length < max;
  const stem = keepExt ? name.slice(0, -ext.length) : name;
  const cut = stem.slice(0, max - (keepExt ? ext.length : 0)).replace(/[. ]+$/, '');
  return `${cut || '_'}${keepExt ? ext : ''}`;
}

/** One path segment, cleaned with the library's safeFileName and shortened. */
export function cleanSegment(name, safeFileName, max = SEGMENT_MAX, fallback = 'untitled') {
  return trimName(safeFileName(name, fallback), max);
}

/**
 * Splits a walkContents `_path` ("Week 3 / Lecture / Slides") into the folders
 * that hold the item: the last part is the item's own title, so it is dropped.
 */
export function folderParts(path) {
  const parts = String(path ?? '').split(' / ').map((p) => p.trim());
  return parts.slice(0, -1).filter((p) => p && p !== '.' && p !== '..');
}

/** True when `target` is `root` itself or somewhere below it. */
export function isInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Builds `<root>/<course>/<folders...>/<fileName>`, cleaning every part and
 * keeping the whole path under the Windows length limit by shortening the
 * folders first, then dropping the outermost ones, then the file name.
 * Throws if the result would land outside `root`.
 */
export function targetPath({ root, course, folders = [], fileName }, safeFileName) {
  // Full names: sections of one subject often differ only at the end ("... (Lecture B)").
  const courseDir = cleanSegment(course, safeFileName, 80, 'course');
  let file = cleanSegment(fileName, safeFileName, 100, 'file');
  let dirs = folders.map((f) => cleanSegment(f, safeFileName));

  const base = resolve(root).length + courseDir.length + 2;
  const fits = () => base + dirs.reduce((n, d) => n + d.length + 1, 0) + file.length <= PATH_MAX;

  if (!fits() && dirs.length) {
    const share = Math.floor((PATH_MAX - base - file.length) / dirs.length) - 1;
    dirs = dirs.map((d) => trimName(d, Math.max(FOLDER_MIN, share)));
  }
  while (!fits() && dirs.length) dirs = dirs.slice(1);
  if (!fits()) file = trimName(file, Math.max(12, PATH_MAX - base));

  const full = join(resolve(root), courseDir, ...dirs, file);
  if (!isInside(root, full) || full === resolve(root)) {
    throw Object.assign(new Error('文件路径不安全，已跳过。'), { code: 'UNSAFE_PATH' });
  }
  return full;
}

/**
 * A file counts as already downloaded when one with the same name is there
 * and, when the size is known, the same size. Google documents have no size
 * until they are exported, so for them the name alone decides.
 *
 * When a teacher replaces a file, the library keeps the old one and saves the
 * new version as "name (1).pdf", so those numbered copies count too;
 * otherwise every run would add another copy.
 */
export function alreadyThere(path, size) {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let i = 0; i < 100; i += 1) {
    const candidate = i === 0 ? path : `${stem} (${i})${ext}`;
    if (!existsSync(candidate)) return false;
    const stat = statSync(candidate);
    if (stat.isFile() && (size == null || stat.size === size)) return true;
  }
  return false;
}

/**
 * Target paths for one course's listed files. Two different files that would
 * land on the same path (same name in the same folder) get "name (2).pdf"
 * and so on, in listing order, so each keeps a stable place of its own.
 */
export function planPaths(root, course, files, safeFileName) {
  const used = new Set();
  return files.map((file) => {
    let path = targetPath({ root, course, folders: file.folders, fileName: file.name }, safeFileName);
    const ext = extname(path);
    const stem = path.slice(0, path.length - ext.length);
    for (let n = 2; used.has(path.toLowerCase()); n += 1) path = `${stem} (${n})${ext}`;
    used.add(path.toLowerCase());
    return path;
  });
}
