# Module 3: section navigation, display settings and beginner safety nets

Spec for Claude Code. Read CLAUDE.md first (rules, the user we design for, versions). Functional work: plain style; the visual redesign comes later, so build the structure in a way the redesign can restyle easily (clear section ids, CSS classes, no inline styles).

## 1. Sections and navigation

- The page is a set of sections, each with a stable id: 截止日期 (with grades and announcements as they are now, or as their own sections if that reads better), 清单, 课程消息, 课程文件. Keep the current order unless it is clearly worse.
- A navigation bar at the top lists the visible sections; clicking one scrolls smoothly to it and updates the URL hash (so a refresh stays there). On a narrow screen it scrolls sideways or wraps, never overflows.
- Show which section is in view (highlight it in the bar while scrolling).
- Each nav item can carry a small count where useful: 截止日期 (due soon + overdue), 清单 (open items), 课程消息 (unread).
- A 回到顶部 ↑ button appears in the bottom-right corner after scrolling down about one screen, and scrolls back to the top. Keyboard reachable, with an aria-label.

## 2. Display settings (small switches only)

The owner wants customisation to stay small; no drag-and-drop layout.

- A 显示设置 button in the header opens a small panel with:
  - one switch per section to show or hide it (default: all shown). Hidden sections also leave the nav bar. At least one section must stay visible.
  - 课程名: 完整 (default) / 简短. Short = the course's main subject name; derive it from the full name by dropping term and cohort parts where the pattern is clear, otherwise keep the full name. The full name always shows on hover (title attribute) and in the expanded views. Unit-test the shortening on made-up names that look like the owner's (programme prefix, subject, term, group/lecture suffixes) and on names it must leave alone.
  - 恢复默认.
- Saved in settings.json, applied immediately, kept after restart. Put the switch list in one place so adding a switch later is one entry.

## 3. Beginner safety nets

- **Don't close the black window**: a small persistent note in the footer: 💡 使用时请保持那个黑色窗口开着，关掉它面板就停止了。 If the page loses the server (fetch fails repeatedly), show a clear banner: 面板已停止运行（可能是黑色窗口被关掉了）。请重新双击 start.bat。 and stop polling until it comes back.
- **Errors in plain words**: go through every place the page shows an error and make sure it is plain Chinese and says what to do next, with a button where there is one obvious action (重新连接 / 重试 / 选择文件夹). No raw English errors or codes on screen (they can go to the console).
- **Empty states**: every section shows a friendly line when it has nothing (no deadlines, no messages, no files, nothing in the checklist), never a blank box.
- **Tips use the lightbulb**: start every hint line with the same lightbulb icon (see the owner's notes in `docs/dev/step5-onboarding.md`), so it is consistent before the redesign.

## Tests and release

- Unit tests for course-name shortening and the settings (defaults, validation, at least one visible section).
- Check in demo mode (narrow, wide, dark), with sections hidden and shown, after a restart, and with the server stopped (banner appears, recovers when restarted).
- `git diff` checked for cookies, personal paths, names and real course data; commit in English as HeathTeng; bump to the next patch version; push main first, then the tag.
