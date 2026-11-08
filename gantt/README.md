# Gantt Planner

A browser-based project planner with Gantt charts, inspired by the feature set
of desktop tools like [GanttProject](https://www.ganttproject.biz/). It is an
original implementation (React + TypeScript) and shares no code with
GanttProject.

## Features

- **Task tree**: tasks, subtasks and milestones, with indent/outdent, reordering,
  collapse/expand and automatic WBS numbering (1, 1.1, 1.2 …).
- **Interactive chart**: drag a bar to move it, drag its right edge to change the
  duration, drag the dot at its end onto another task to link them. Double-click
  any row or bar for the full properties dialog.
- **Dependencies**: Finish→Start, Start→Start, Finish→Finish and Start→Finish,
  with lag or lead in working days. Successors reschedule automatically. Links
  that would form a loop are refused. Links to summary tasks apply to everything
  inside them.
- **Critical path**: highlights the chain of tasks with no slack. Each bar's
  tooltip shows its slack.
- **Working-day calendar**: durations count working days, and weekends are skipped
  unless "Work weekends" is on.
- **Resources**: people and roles, assignments per task, and a load chart that
  flags days where someone is booked on more than one task.
- **Progress**: per-task % complete. Summary rows roll it up, weighted by duration.
- **Zoom**: day, week or month scale, plus a "Today" jump.
- **Undo/redo** for every edit, and **autosave** to the browser.
- **Files**: save/open `.gantt.json`, **import GanttProject `.gan` files**
  (tasks, nesting, milestones, progress, colours, notes, dependencies,
  resources, allocations), export CSV, print.

## Keyboard

| Keys | Action |
| --- | --- |
| Insert | New task |
| Enter | Open the selected task's properties |
| Delete / Backspace | Delete the selected task or link |
| ↑ / ↓ | Move the selection |
| Alt+Shift+→ / ← | Indent / outdent |
| Alt+Shift+↑ / ↓ | Move the task up / down |
| Ctrl/⌘+Z, Ctrl/⌘+Shift+Z (or Ctrl+Y) | Undo / redo |
| Ctrl/⌘+S | Save to file |

## Development

```sh
cd gantt
npm install
npm run dev      # http://localhost:5173
npm test         # scheduling engine, editing and file-format tests
npm run build    # type-check + production build into dist/
```

The scheduling engine (`src/schedule.ts`) and the editing operations
(`src/project.ts`) are plain functions with no React dependency. It works in
working-day index space (`src/calendar.ts`), so weekend handling is a single
mapping and not special cases scattered through the arithmetic.
