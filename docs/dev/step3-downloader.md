# Stage 1, step 3: course file downloader

Spec for Claude Code. Read CLAUDE.md first; its rules (read-only, no secrets, zero runtime dependencies, Windows first, Chinese UI) apply.

## Goal

From the dashboard, a student picks course files and downloads them into a folder they choose (for example a USB drive), organised by course, so they can hand them to an AI tool without clicking through Blackboard.

## What the student sees

A new section 课程文件 (or a tab next to the existing sections) with:

1. **保存位置**: shows the chosen folder and a 选择文件夹 button. The button opens the normal Windows folder picker. The choice is remembered for next time.
2. **File list**, grouped by course, each course collapsible. Each row: checkbox, file name, the folder path inside the course (e.g. "Week 3 / Lecture"), size, and 已下载 if it is already in the target folder.
   - A select-all checkbox for everything and one per course.
   - Courses are listed first; a course's files load when it is expanded (walking every course up front is slow).
   - Public Google Docs/Slides/Sheets links in the course are listed too, marked 外部文档.
3. **下载选中的文件** button. While it runs: a progress line (第 x / y 个, current file name) and a 停止 button. At the end: how many downloaded, skipped (already there), failed, with the failure reason per file, and an 打开文件夹 button.
4. A checkbox **同时导出给 AI 用的文字版 (.txt)**: for each downloaded PDF/DOCX/PPTX, also save a .txt with the extracted text next to it.

## Where files go

```
<chosen folder>/
└── <course code or name>/
    └── <folder path inside the course>/
        └── <file name>
```

- Names cleaned with the library's `safeFileName`; Windows-illegal characters removed, path segments trimmed to a sane length (Windows 260-char path limit matters on USB drives).
- If a file with the same name and size already exists, skip it and count it as 已存在.

## How to build it (blackboard-mcp library, already bundled)

- List: `client.walkContents(courseId, { maxNodes: 600 })`. For each node:
  - `fileDetailOf(node)` → a stored file (`fileName`, `fileSize`, `permanentUrl`).
  - `linkTargetOf(...)` + `recogniseExternalDocument(url)` → a Google document; skip links that are not recognised.
  - Use `node._path` for the folder path.
- Download: `downloadToDisk(client.http, rawFileUrl(detail), { dir, fileName, maxBytes, expectedBytes, reuseExisting: true })`. External: `fetchExternalDocument(doc, { maxBytes })` then write the buffer, file name from `externalFileName`.
- Text export: `extractText` from the library.
- Look at blackboard-mcp's own `src/tools/files.ts` (`bb_download_course_files`) for the reference pattern.
- Download one file at a time (be gentle with the school's server), keep the session keeper running, and if the session expires mid-run call the existing silent renewal once, then continue.

## Server

- `GET /api/courses/:id/files` → the file list for one course (cache for 5 minutes like the overview).
- `GET /api/settings`, `POST /api/settings { downloadDir }`. Store in `~/.blackboard-study-hub/settings.json`.
- `POST /api/pick-folder` → opens the native picker and returns the chosen path (or null if cancelled). On Windows use PowerShell `-STA` with the Explorer-style IFileOpenDialog (FOS_PICKFOLDERS, C# through Add-Type; `System.Windows.Forms.FolderBrowserDialog` as the fallback), no extra dependency; make the dialog appear in front. Before any window: DPI awareness (per-monitor v2, else `SetProcessDPIAware`) and `EnableVisualStyles`; never switch the console to UTF-8 (it turns the dialog's own words English), write the path as UTF-8 bytes instead; buttons 选择这个文件夹 / 文件夹：. In demo mode the window opens but nothing is saved (`demoPicked`). On other systems return an error and let the user type a path.
- `POST /api/download { items, exportText }` starts a job and returns 202; `GET /api/download` returns progress; `POST /api/download/stop`. Same job pattern as `/api/connect`.
- `POST /api/open-folder` opens the target folder in Explorer.
- Keep the existing Host/Origin checks on every new route. Only accept a download dir that is an absolute path and exists (or can be created); never write outside it (check every resolved path stays inside the dir).
- Demo mode: fake courses and files, and a fake download that only simulates progress (writes nothing).

## Tests

- Path building and cleaning (illegal characters, long names, `..` segments cannot escape the folder).
- Skip-existing logic.
- Keep `npm test` passing.

## Docs

- Add a short "下载课程文件" part to the README Chinese guide, with a screenshot from demo mode.
- Add FAQ entries: a file failed because it is too large (the size limit), a link that is not public, where the files went.

## Done when

- Works in demo mode and against the real school account: pick a USB folder, download one course, run again and everything is skipped.
- `git diff` checked for cookies, personal paths and names before committing; commit in English as HeathTeng and push.
