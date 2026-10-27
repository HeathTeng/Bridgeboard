// 选择文件夹: the system's own folder picker, so a student never types a path.
// Windows uses PowerShell, a Mac AppleScript (osascript, built in). Both only
// hand back the chosen path; cancelling gives null and changes nothing. The
// command runner is passed in, so the tests never open a real window.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const TITLE = '选择保存课程文件的文件夹（可以选 U 盘）';
const TEN_MINUTES = 10 * 60 * 1000;

/** Systems with a picker; elsewhere the page asks for the path to be typed in. */
export const canPick = (platform = process.platform) => platform === 'win32' || platform === 'darwin';

// The native Windows folder picker: the Explorer-style IFileOpenDialog with
// FOS_PICKFOLDERS, through a few lines of C# compiled by Add-Type (no extra
// dependency). If that fails for any reason, the older FolderBrowserDialog is
// shown instead, so a folder can always be picked; BBHUB_PICKER=classic forces
// it. PowerShell -STA is needed for both; a hidden top-most owner window keeps
// the dialog in front of the browser. Prints the chosen path, or nothing.
export const PICK_FOLDER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$title = '选择保存课程文件的文件夹（可以选 U 盘）'
$start = ''
if ($env:BBHUB_START -and (Test-Path -LiteralPath $env:BBHUB_START)) { $start = $env:BBHUB_START }
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$picked = $null
$shown = $false
if ($env:BBHUB_PICKER -ne 'classic') {
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BbHubFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog {}

  // Methods in vtable order, up to the last one used (GetResult).
  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint count, IntPtr specs);
    void SetFileTypeIndex(uint index);
    void GetFileTypeIndex(out uint index);
    void Advise(IntPtr events, out uint cookie);
    void Unadvise(uint cookie);
    void SetOptions(uint options);
    void GetOptions(out uint options);
    void SetDefaultFolder(IShellItem item);
    void SetFolder(IShellItem item);
    void GetFolder(out IShellItem item);
    void GetCurrentSelection(out IShellItem item);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
    void GetResult(out IShellItem item);
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IShellItem {
    void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid iid, out IntPtr result);
    void GetParent(out IShellItem parent);
    void GetDisplayName(uint form, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attributes);
    void Compare(IShellItem other, uint hint, out int order);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  private static extern void SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid iid, out IShellItem item);

  private const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
  private const uint SIGDN_FILESYSPATH = 0x80058000;
  private const int ERROR_CANCELLED = unchecked((int)0x800704C7);

  /** The chosen folder, or null if the student cancelled. Throws on any other failure. */
  public static string Pick(IntPtr owner, string title, string start) {
    IFileDialog dialog = (IFileDialog)new FileOpenDialog();
    try {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
      dialog.SetTitle(title);
      if (!String.IsNullOrEmpty(start)) {
        try {
          Guid iid = typeof(IShellItem).GUID;
          IShellItem folder;
          SHCreateItemFromParsingName(start, IntPtr.Zero, ref iid, out folder);
          dialog.SetFolder(folder);
        } catch (Exception) {
          // A folder that has gone away (USB drive unplugged): open at the default place.
        }
      }
      int hr = dialog.Show(owner);
      if (hr == ERROR_CANCELLED) return null;
      Marshal.ThrowExceptionForHR(hr);
      IShellItem item;
      dialog.GetResult(out item);
      string path;
      item.GetDisplayName(SIGDN_FILESYSPATH, out path);
      return path;
    } finally {
      Marshal.ReleaseComObject(dialog);
    }
  }
}
'@
    $picked = [BbHubFolderPicker]::Pick($owner.Handle, $title, $start)
    $shown = $true
  } catch {
    [Console]::Error.WriteLine("new folder picker failed, using the classic one: $($_.Exception.Message)")
  }
}
if (-not $shown) {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = $title
  $dialog.ShowNewFolderButton = $true
  if ($start) { $dialog.SelectedPath = $start }
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $dialog.SelectedPath }
}
if ($picked) { $picked }
$owner.Dispose()
`;

// The Mac picker: AppleScript's choose folder, started where the folder is
// now (given as an argument, never pasted into the script). `activate` brings
// the window in front of the browser. Cancelling is error -128.
export const MAC_PICK_FOLDER = [
  'on run argv',
  'activate',
  'set startPath to item 1 of argv',
  'if startPath is "" then',
  `set chosen to choose folder with prompt "${TITLE}"`,
  'else',
  `set chosen to choose folder with prompt "${TITLE}" default location (POSIX file startPath)`,
  'end if',
  'return POSIX path of chosen',
  'end run',
];

/** The command for this system: [file, args, options]. */
export function pickCommand(platform, start) {
  const from = start && existsSync(start) ? start : '';
  if (platform === 'darwin') {
    return ['osascript', [...MAC_PICK_FOLDER.flatMap((line) => ['-e', line]), from], { timeout: TEN_MINUTES }];
  }
  return [
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', PICK_FOLDER],
    { env: { ...process.env, BBHUB_START: from }, windowsHide: true, timeout: TEN_MINUTES },
  ];
}

/** The chosen folder, or null when the window was closed or cancelled. */
export function pickFolder(start, { platform = process.platform, run = execFile } = {}) {
  const [file, args, options] = pickCommand(platform, start);
  return new Promise((resolve, reject) => {
    run(file, args, options, (err, stdout = '', stderr = '') => {
      // Cancel on a Mac: "User canceled. (-128)". Nothing to report.
      if (err && /-128/.test(stderr)) return resolve(null);
      if (stderr.trim()) console.log(stderr.trim());
      if (err) return reject(err);
      const path = stdout.trim();
      // AppleScript ends a folder path with "/"; keep it only for the disk itself.
      return resolve((path.length > 1 ? path.replace(/\/+$/, '') : path) || null);
    });
  });
}
