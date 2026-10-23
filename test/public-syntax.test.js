// The page scripts in public/ are not imported by any other test (they need a
// browser), so at least make sure each one parses: one syntax error stops the
// whole page at 正在连接….
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(import.meta.dirname, '..', 'public');

test('every page script parses', () => {
  const files = readdirSync(PUBLIC).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(PUBLIC, file)], { stdio: 'pipe' }), file);
  }
});
