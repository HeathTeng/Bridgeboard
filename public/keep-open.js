// 不再提示 on the keep-the-black-window-open reminder. The choice is kept in
// this browser's localStorage with a version, so changing the reminder's
// wording and raising the version shows it once more. theme.js reads the same
// key before the page is drawn, so a dismissed reminder never flashes.

export const KEEP_OPEN_KEY = 'bridgeboard-keep-open-dismissed';
// Same number as KEEP_OPEN_VERSION in theme.js (a test checks they match).
export const KEEP_OPEN_VERSION = '2';

/** Hides the reminder for good once 不再提示 is clicked. Works without storage too (just for this visit). */
export function initKeepOpen({ wrap, button, root, storage }) {
  button.addEventListener('click', () => {
    wrap.hidden = true;
    root.dataset.keepOpenOff = '';
    try {
      storage.setItem(KEEP_OPEN_KEY, KEEP_OPEN_VERSION);
    } catch {
      // No storage (private window): hidden for this visit only.
    }
  });
}
