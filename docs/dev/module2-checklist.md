# Module 2: checklist

Spec for Claude Code. Read CLAUDE.md first (rules, the user we design for, versions). Functional work: keep the current plain style; the visual redesign comes later.

## Goal

One place that answers "what do I still have to do?": Blackboard work appears there by itself, and the student can add their own to-dos, like a phone reminders app.

## What the student sees

A new 清单 section with two parts.

### Top: 作业清单 (automatic)

- Every deadline from module 1 that has **opened** (its opening time, or first-seen time, is now or earlier) shows up here automatically.
- Each row: a round checkbox, the title (link to Blackboard, same as module 1), the course, the colour and time-left label from module 1.
- When Blackboard shows it as submitted, it ticks itself and moves down into a collapsed 已完成 group.
- The student can also tick it by hand, for work handed in another way. That is only a local mark: show the label 已手动标记完成 (不会在 Blackboard 上提交), and allow unticking. Never call any Blackboard write operation.
- Items whose due date passed more than 14 days ago and are done drop off the list.

### Bottom: 我的清单 (written by the student)

- An input at the top: type, press Enter (or click 添加) to add. Empty input does nothing.
- Each row: round checkbox, the text, and on hover or tap: edit (click the text to edit in place, Enter to save, Esc to cancel) and delete.
- Optional due date per item (a simple date and time picker); when set, the row shows the same colour and time-left label as assignments.
- Ticked items get a strikethrough and move to the bottom, in a collapsed 已完成 group; 清除已完成 removes them all.
- Delete shows a short 已删除 · 撤销 bar for a few seconds, so a mis-click is not a loss.

## Beginner checks (from CLAUDE.md)

- Empty states: 作业清单 empty → "目前没有已开放的作业 🎉"; 我的清单 empty → a one-line hint on how to add an item.
- A short note under the section title: 作业会自动出现在上面；下面可以写你自己的待办，只保存在这台电脑上。
- Text limited to 200 characters, at most 500 items; say so in plain Chinese if hit.
- Nothing is lost on refresh or restart.

## Storage and server

- Save in `~/.blackboard-study-hub/checklist.json`: own items (id, text, due?, done, createdAt, doneAt) and manual marks for assignments (keyed like seen.json). Write atomically (temp file then rename) so a crash can't corrupt it.
- Routes, all behind the existing Host/Origin checks: `GET /api/checklist`, `POST /api/checklist/items` (add), `PATCH /api/checklist/items/:id` (text, due, done), `DELETE /api/checklist/items/:id`, `POST /api/checklist/clear-done`, `PUT /api/checklist/marks/:key` (manual tick for an assignment). Validate every field; unknown ids return 404 in plain Chinese.
- Demo mode: start with a few sample items, keep changes in memory only, write nothing to disk.

## Tests and release

- Unit tests for the store (add, edit, tick, delete, clear done, limits, atomic write, bad input) and for which assignments appear (opened vs not yet, auto-done, 14-day drop-off).
- Check in demo mode (narrow and wide window, dark mode) and with the real account.
- `git diff` checked for cookies, personal paths, names and real course data; commit in English as HeathTeng; bump to the next patch version per CLAUDE.md; push main first, and only push the tag after main is pushed successfully.
