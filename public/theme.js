// Loaded in <head> before the stylesheet, as a plain (non-module) script, so
// the saved theme is on <html> before anything is drawn: no white flash when
// 夜间 is chosen. settings.json stays the real record; layout.js keeps this
// copy in localStorage up to date.
try {
  var theme = localStorage.getItem('bridgeboard-theme');
  if (theme === 'light' || theme === 'dark' || theme === 'eye') document.documentElement.dataset.theme = theme;
} catch (e) {
  // No storage (private window, blocked site data): the page still follows the computer.
}
