// Remembers when the hub first saw each deadline, for items whose real opening
// date Blackboard does not give. Kept in ~/.blackboard-study-hub/seen.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Old name kept on purpose after the rename to Bridgeboard: existing users' data lives in this folder.
export const SEEN_FILE = join(homedir(), '.blackboard-study-hub', 'seen.json');
const KEEP_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Returns key -> first-seen ISO time for the given keys, recording new ones.
 * On the very first run every key is stored as null ("already there when
 * tracking began"), so the first launch does not mark everything as new.
 */
export function firstSeen(keys, now = Date.now(), file = SEEN_FILE) {
  let known;
  try {
    known = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    known = undefined;
  }
  const firstRun = !known || typeof known !== 'object';
  const store = firstRun ? {} : known;
  let changed = firstRun;
  for (const key of keys) {
    if (key in store) continue;
    store[key] = firstRun ? null : new Date(now).toISOString();
    changed = true;
  }
  // Forget entries old enough that the deadline is long gone.
  for (const [key, at] of Object.entries(store)) {
    if (at && now - Date.parse(at) > KEEP_MS) {
      delete store[key];
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  }
  return Object.fromEntries(keys.map((k) => [k, store[k] ?? undefined]));
}
