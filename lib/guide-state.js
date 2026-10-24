// Whether the first-run guide (guideSeen) and the spotlight tour (tourSeen,
// asked once after the first sign-in) have been seen. Saved in settings.json,
// so they are remembered in any browser. Demo mode writes no files: it
// remembers only while it runs, so every demo start shows the guide.
import { loadSettings, saveSettings } from './settings.js';

export function guideStore({ key = 'guideSeen', demo = false, load = loadSettings, save = saveSettings } = {}) {
  // Also the fallback when settings.json cannot be written: at least this run remembers.
  let seenNow = false;
  return {
    seen: () => seenNow || (!demo && load()[key] === true),
    markSeen() {
      seenNow = true;
      if (demo) return;
      try {
        save({ [key]: true });
      } catch (err) {
        console.log(`没能把「${key}」写进设置文件：`, err.code ?? err.message);
      }
    },
  };
}
