// Loaded in <head> before the stylesheet, as a plain (non-module) script, so
// the saved 外观 and 护眼 are on <html> before anything is drawn: no white
// flash when 夜间 is chosen. settings.json stays the real record; layout.js
// keeps this copy in localStorage up to date.
try {
  var root = document.documentElement;
  var theme = localStorage.getItem('bridgeboard-theme');
  var eye = localStorage.getItem('bridgeboard-eye') === 'on';
  // An older version saved 护眼 as a theme of its own: 白天 with 护眼 on.
  if (theme === 'eye') {
    theme = 'light';
    eye = true;
  }
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  if (eye) root.dataset.eye = '';
  // The keep-the-black-window-open reminder: hidden once 不再提示 was clicked
  // for this version of its wording. Change the wording, raise the version
  // here and in keep-open.js (a test checks they match).
  var KEEP_OPEN_VERSION = '1';
  if (localStorage.getItem('bridgeboard-keep-open-dismissed') === KEEP_OPEN_VERSION) root.dataset.keepOpenOff = '';
} catch (e) {
  // No storage (private window, blocked site data): the page still follows the computer.
}
