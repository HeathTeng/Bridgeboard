// The app is called Bridgeboard now, but these four names must stay the old
// ones, or existing users lose data or get duplicates (docs/dev/ui-redesign.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toIcs } from '../lib/ics.js';
import { CHECKLIST_FILE } from '../lib/checklist.js';
import { SEEN_FILE } from '../lib/seen.js';
import { SENT_FILE } from '../lib/push.js';
import { profileDir } from '../lib/edge-login.js';

const read = (file) => readFileSync(join(import.meta.dirname, '..', file), 'utf8');

test('the data folder keeps its old name', () => {
  const dir = join(homedir(), '.blackboard-study-hub');
  for (const file of [CHECKLIST_FILE, SEEN_FILE, SENT_FILE]) assert.ok(file.startsWith(dir), file);
  if (!process.env.BB_HUB_BROWSER_PROFILE) assert.equal(profileDir(), join(dir, 'browser-profile'));
  assert.match(read('lib/settings.js'), /join\(homedir\(\), '\.blackboard-study-hub'\)/);
});

test('calendar UIDs keep the old suffix', () => {
  const ics = toIcs([{ title: 'Essay', course: 'Management', due: '2026-10-25T15:59:00.000Z' }]);
  assert.match(ics, /^UID:[0-9a-f]{40}@blackboard-study-hub\r?$/m);
});

test('the Startup launcher and the /api/ping app id keep the old name', () => {
  assert.match(read('lib/autostart.js'), /const NAME = 'blackboard-study-hub\.cmd';/);
  assert.match(read('server.js'), /const APP_ID = 'blackboard-study-hub';/);
});

test('the new name is used where students see it', () => {
  assert.equal(JSON.parse(read('package.json')).name, 'bridgeboard');
  assert.match(read('public/index.html'), /<title>Bridgeboard<\/title>/);
  assert.match(read('scripts/build-portable.sh'), /NAME="Bridgeboard"/);
  assert.match(read('scripts/build-portable.sh'), /\$NAME-Windows\.zip/);
});
