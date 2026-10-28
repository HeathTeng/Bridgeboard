// 选择文件夹 on Windows: the PowerShell script must make a sharp, Chinese,
// modern-looking window. These read the script itself; no window is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PICK_FOLDER } from '../lib/pick-folder.js';

const firstWindow = PICK_FOLDER.indexOf('New-Object System.Windows.Forms.');

test('Windows picker: DPI awareness is turned on before any window', () => {
  assert.ok(firstWindow > 0, 'the script creates a window');
  assert.match(PICK_FOLDER, /SetProcessDpiAwarenessContext\(new IntPtr\(-4\)\)/, 'per-monitor v2 first');
  assert.match(PICK_FOLDER, /SetProcessDPIAware\(\)/, 'older Windows: system-wide awareness');
  const call = PICK_FOLDER.indexOf('[BbHubDpi]::UseScreenDpi()');
  assert.ok(call > 0 && call < firstWindow, 'called before the owner form is made');
});

test('Windows picker: visual styles before any window, so the classic dialog looks modern too', () => {
  const styles = PICK_FOLDER.indexOf('[System.Windows.Forms.Application]::EnableVisualStyles()');
  assert.ok(styles > 0 && styles < firstWindow);
  assert.ok(styles < PICK_FOLDER.indexOf('FolderBrowserDialog'));
});

test('Windows picker: Chinese button words', () => {
  assert.match(PICK_FOLDER, /dialog\.SetOkButtonLabel\("选择这个文件夹"\);/);
  assert.match(PICK_FOLDER, /dialog\.SetFileNameLabel\("文件夹："\);/);
  // Switching the console to UTF-8 makes Windows show the dialog's own words
  // (Cancel, ...) in English; the path is written as UTF-8 bytes instead.
  assert.doesNotMatch(PICK_FOLDER, /OutputEncoding/);
  assert.match(PICK_FOLDER, /Write-Utf8 \(\[Console\]::OpenStandardOutput\(\)\) \$picked/);
});
