// The words that differ between Windows and Mac: what the window the panel
// runs in is called, which file to double-click, where the settings are.
// The server tells the page its system in /api/ping (`os`); everything that
// mentions the window or the launcher takes its words from here. No
// Node-only code: the page loads it as /os-words.js.

export const OSES = ['windows', 'mac'];

/** 'windows', 'mac' or 'other' (Linux, for developers) from process.platform. */
export function osOf(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'mac';
  return 'other';
}

/**
 * The system the server runs on. `--os=mac` / `--os=windows` only changes the
 * words (to preview the other system's wording); nothing else follows it.
 */
export function serverOs(platform, argv = []) {
  const forced = argv.find((a) => a.startsWith('--os='))?.slice(5);
  return OSES.includes(forced) ? forced : osOf(platform);
}

export const WORDS = {
  windows: {
    window: '黑色窗口',
    launcher: 'start.bat',
    demoLauncher: 'demo.bat',
    system: 'Windows',
    systemExample: 'Windows 11',
    folderExample: 'E:\\课程资料',
    taskbar: '任务栏',
    copyKey: 'Ctrl+C',
  },
  mac: {
    window: '终端窗口',
    launcher: 'start.command',
    demoLauncher: 'demo.command',
    system: 'macOS',
    systemExample: 'macOS 15',
    folderExample: '/Users/你的名字/课程资料',
    taskbar: '程序坞',
    copyKey: '⌘C',
  },
};

/** The words for one system; Linux and unknown get the Windows ones (the first-stage wording). */
export function wordsFor(os) {
  return WORDS[os] ?? WORDS.windows;
}
