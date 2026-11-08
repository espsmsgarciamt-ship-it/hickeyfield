import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate, parseDate } from "./calendar";
import { useHistory } from "./history";
import {
  download,
  loadStored,
  parseProjectFile,
  pickFile,
  safeFilename,
  sampleProject,
  serializeProject,
  store,
  toCSV,
} from "./io";
import { emptyProject, todayISO, type Project } from "./model";
import * as ops from "./project";
import { computeSchedule } from "./schedule";
import { CommitInput } from "./components/CommitInput";
import { GanttChart } from "./components/GanttChart";
import { gridWidth, GridHeader, TaskGrid } from "./components/TaskGrid";
import { ResourceView, RES_GRID_WIDTH } from "./components/ResourceView";
import { TaskDialog, type TaskEdit } from "./components/TaskDialog";
import { makeAxis, PX_PER_DAY, TimelineHeader, type Zoom } from "./components/timeline";

type Tab = "gantt" | "resources";

/** Phones and tablets start with the compact table so the chart gets the room. */
const NARROW = () => typeof window !== "undefined" && window.innerWidth < 1200;
const TOUCH = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export default function App() {
  const history = useHistory(() => loadStored() ?? sampleProject());
  const { project, commit, undo, redo, canUndo, canRedo, reset } = history;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDepId, setSelectedDepId] = useState<string | null>(null);
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("day");
  const [showCritical, setShowCritical] = useState(false);
  const [tab, setTab] = useState<Tab>("gantt");
  const [toast, setToast] = useState<string | null>(null);
  const [viewport, setViewport] = useState(1200);
  const [compact, setCompact] = useState(NARROW);
  const [menuOpen, setMenuOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewLeft, setViewLeft] = useState(0);
  const scrollFrame = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => setViewLeft(scroller.current?.scrollLeft ?? 0));
  };

  const schedule = useMemo(() => computeSchedule(project), [project]);
  const today = parseDate(todayISO());

  useEffect(() => {
    const t = setTimeout(() => store(project), 300);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drop selections that no longer exist (after undo, delete, load…).
  useEffect(() => {
    if (selectedId && !project.tasks.some((t) => t.id === selectedId)) setSelectedId(null);
    if (selectedDepId && !project.dependencies.some((d) => d.id === selectedDepId)) setSelectedDepId(null);
    if (dialogId && !project.tasks.some((t) => t.id === dialogId)) setDialogId(null);
  }, [project, selectedId, selectedDepId, dialogId]);

  /** Applies an edit; refused edits surface as a toast and change nothing. */
  const apply = useCallback(
    (fn: (p: Project) => Project): boolean => {
      try {
        commit(fn(project));
        return true;
      } catch (e) {
        if (e instanceof ops.EditError) {
          setToast(e.message);
          return false;
        }
        throw e;
      }
    },
    [commit, project],
  );

  const px = PX_PER_DAY[zoom];
  const axis = useMemo(() => {
    const hasTasks = project.tasks.length > 0;
    const s = Math.min(hasTasks ? schedule.projectStartDay : today, today);
    const e = Math.max(hasTasks ? schedule.projectEndDay : today, today);
    const pad = zoom === "month" ? 30 : zoom === "week" ? 14 : 7;
    const startDay = s - pad - ((((s - pad + 4) % 7) + 6) % 7); // back to a Monday
    const gridW = tab === "gantt" ? gridWidth(compact) : RES_GRID_WIDTH;
    return makeAxis(startDay, e + pad * 3, px, Math.max(400, viewport - gridW));
  }, [project.tasks.length, schedule, today, zoom, px, viewport, tab, compact]);

  const scrollToDay = useCallback(
    (day: number, smooth = true) => {
      const el = scroller.current;
      if (!el) return;
      const gridW = tab === "gantt" ? gridWidth(compact) : RES_GRID_WIDTH;
      const visible = Math.max(0, el.clientWidth - gridW);
      const margin = Math.min(3 * px * (zoom === "day" ? 3 : 7), visible * 0.2);
      el.scrollTo({ left: Math.max(0, axis.x(day) - margin), behavior: smooth ? "smooth" : "auto" });
    },
    [axis, px, zoom, tab, compact],
  );

  // Open each project scrolled to today (or to its start, if today is outside
  // it), so a phone-sized screen never opens on empty days.
  const [opened, setOpened] = useState(0);
  const openedRef = useRef(-1);
  useEffect(() => {
    if (openedRef.current === opened) return;
    openedRef.current = opened;
    const inside = today >= schedule.projectStartDay && today <= schedule.projectEndDay;
    scrollToDay(inside || !project.tasks.length ? today : schedule.projectStartDay, false);
  });

  // --- task commands -------------------------------------------------------
  const addTask = () => {
    const [p, id] = ops.addTask(project, selectedId);
    commit(p);
    setSelectedId(id);
  };
  const addSubtask = () => {
    if (!selectedId) return addTask();
    try {
      const [p, id] = ops.addSubtask(project, selectedId);
      commit(p);
      setSelectedId(id);
    } catch (e) {
      if (e instanceof ops.EditError) setToast(e.message);
      else throw e;
    }
  };
  const addMilestone = () => {
    const [p, id] = ops.addTask(project, selectedId, { name: "Milestone", milestone: true, duration: 0 });
    commit(p);
    setSelectedId(id);
  };
  const deleteSelected = () => {
    if (selectedDepId) {
      apply((p) => ops.removeDependency(p, selectedDepId));
      setSelectedDepId(null);
    } else if (selectedId) {
      const ids = schedule.visible;
      const i = ids.indexOf(selectedId);
      apply((p) => ops.deleteTask(p, selectedId));
      setSelectedId(ids[i + 1] ?? ids[i - 1] ?? null);
    }
  };
  const withSel = (fn: (p: Project, id: string) => Project) => () => {
    if (selectedId) apply((p) => fn(p, selectedId));
  };
  const indent = withSel(ops.indent);
  const outdent = withSel(ops.outdent);
  const moveUp = withSel((p, id) => ops.move(p, id, -1));
  const moveDown = withSel((p, id) => ops.move(p, id, 1));

  const setEndExclusive = (id: string, endExclusiveDay: number) => {
    const c = schedule.byId.get(id)!;
    const duration = Math.max(1, schedule.calendar.toIndex(endExclusiveDay) - c.startIdx);
    apply((p) => ops.updateTask(p, id, { duration }));
  };

  const saveDialog = ({ task, preds }: TaskEdit): string | null => {
    try {
      let p = ops.updateTask(project, task.id, task);
      p = ops.setPredecessors(p, task.id, preds);
      commit(p);
      setDialogId(null);
      return null;
    } catch (e) {
      if (e instanceof ops.EditError) return e.message;
      throw e;
    }
  };

  // --- files ---------------------------------------------------------------
  const newProject = () => {
    if (!confirm("Start a new, empty project? Unsaved changes to this one will be lost.")) return;
    reset(emptyProject());
    setOpened((n) => n + 1);
    setSelectedId(null);
  };
  const openProject = async () => {
    const file = await pickFile(".json,.gan,application/json,text/xml");
    if (!file) return;
    try {
      reset(parseProjectFile(await file.text(), file.name));
      setOpened((n) => n + 1);
      setSelectedId(null);
      setToast(`Opened ${file.name}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't open that file.");
    }
  };
  const saveProject = () =>
    download(`${safeFilename(project.name)}.gantt.json`, serializeProject(project), "application/json");
  const exportCSV = () => download(`${safeFilename(project.name)}.csv`, toCSV(project), "text/csv");

  // --- keyboard ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Checkboxes and buttons keep focus after a click; only text entry should swallow shortcuts.
      const typing =
        el.closest("textarea, select, dialog") ||
        (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type));
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
      } else if (typing) {
        return;
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Insert" || (e.key === "Enter" && !selectedId)) {
        e.preventDefault();
        addTask();
      } else if (e.key === "Enter" && selectedId) {
        setDialogId(selectedId);
      } else if (e.altKey && e.shiftKey && e.key === "ArrowRight") indent();
      else if (e.altKey && e.shiftKey && e.key === "ArrowLeft") outdent();
      else if (e.altKey && e.shiftKey && e.key === "ArrowUp") moveUp();
      else if (e.altKey && e.shiftKey && e.key === "ArrowDown") moveDown();
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const ids = schedule.visible;
        const i = selectedId ? ids.indexOf(selectedId) : -1;
        const next = ids[Math.min(ids.length - 1, Math.max(0, i + (e.key === "ArrowUp" ? -1 : 1)))];
        if (next) {
          setSelectedId(next);
          setSelectedDepId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectTask = (id: string) => {
    setSelectedId(id);
    setSelectedDepId(null);
  };
  const total = project.tasks.filter((t) => !schedule.byId.get(t.id)!.isSummary);
  const doneShare = total.length ? Math.round(total.reduce((s, t) => s + t.progress, 0) / total.length) : 0;

  const fileButtons = (
    <>
      <button onClick={newProject}>New</button>
      <button onClick={openProject} title="Open a saved project or a GanttProject .gan file">
        Open…
      </button>
      <button onClick={saveProject} title="Save (Ctrl+S)">
        Save
      </button>
      <button onClick={exportCSV}>Export CSV</button>
      <button onClick={() => window.print()}>Print</button>
    </>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
            <rect x="2" y="4" width="12" height="4" rx="1.5" fill="var(--accent)" />
            <rect x="8" y="10" width="14" height="4" rx="1.5" fill="var(--accent-2)" />
            <rect x="5" y="16" width="9" height="4" rx="1.5" fill="var(--accent-3)" />
          </svg>
          <CommitInput
            className="project-name"
            value={project.name}
            aria-label="Project name"
            onCommit={(name) => commit({ ...project, name: name.trim() || project.name })}
          />
        </div>
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "gantt"} onClick={() => setTab("gantt")}>
            Gantt
          </button>
          <button role="tab" aria-selected={tab === "resources"} onClick={() => setTab("resources")}>
            Resources
          </button>
        </nav>
        <div className="file-actions">
          {fileButtons}
        </div>
        <div className="file-menu">
          <button aria-expanded={menuOpen} aria-label="File menu" onClick={() => setMenuOpen(!menuOpen)}>
            File ▾
          </button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="menu-pop" onClick={() => setMenuOpen(false)}>
                {fileButtons}
              </div>
            </>
          )}
        </div>
      </header>

      <div className="toolbar">
        {tab === "gantt" && (
          <div className="group">
            <button
              onClick={() => setCompact(!compact)}
              aria-pressed={!compact}
              title={compact ? "Show all table columns" : "Show only task names"}
            >
              {compact ? "Columns ▸" : "◂ Columns"}
            </button>
            <button className="primary" onClick={addTask} title="New task (Insert)">
              + Task
            </button>
            <button onClick={addSubtask} disabled={!selectedId} title="New subtask under the selection">
              + Subtask
            </button>
            <button onClick={addMilestone} title="New milestone">
              ◆ Milestone
            </button>
            <span className="sep" />
            <button onClick={outdent} disabled={!selectedId} title="Outdent (Alt+Shift+←)">
              ⇤
            </button>
            <button onClick={indent} disabled={!selectedId} title="Indent (Alt+Shift+→)">
              ⇥
            </button>
            <button onClick={moveUp} disabled={!selectedId} title="Move up (Alt+Shift+↑)">
              ↑
            </button>
            <button onClick={moveDown} disabled={!selectedId} title="Move down (Alt+Shift+↓)">
              ↓
            </button>
            <button onClick={() => selectedId && setDialogId(selectedId)} disabled={!selectedId} title="Properties (Enter)">
              Edit…
            </button>
            <button
              onClick={deleteSelected}
              disabled={!selectedId && !selectedDepId}
              title={selectedDepId ? "Remove the selected link (Delete)" : "Delete task (Delete)"}
            >
              {selectedDepId ? "Remove link" : "Delete"}
            </button>
          </div>
        )}
        <div className="group">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
        </div>
        <div className="group">
          <div className="segmented" role="radiogroup" aria-label="Zoom">
            {(["day", "week", "month"] as Zoom[]).map((z) => (
              <button key={z} role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)}>
                {z[0].toUpperCase() + z.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => scrollToDay(today)}>Today</button>
        </div>
        <div className="group">
          {tab === "gantt" && (
            <label className="toggle">
              <input type="checkbox" checked={showCritical} onChange={(e) => setShowCritical(e.target.checked)} />
              Critical path
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={project.workWeekends}
              onChange={(e) => commit({ ...project, workWeekends: e.target.checked })}
            />
            Work weekends
          </label>
        </div>
      </div>

      <div className="workspace" ref={scroller} onScroll={onScroll}>
        {tab === "gantt" ? (
          <div className="sheet" style={{ width: gridWidth(compact) + axis.width }}>
            <div className="head-row">
              <GridHeader compact={compact} />
              <TimelineHeader axis={axis} zoom={zoom} viewLeft={viewLeft} />
            </div>
            <div className="body-row">
              <TaskGrid
                project={project}
                schedule={schedule}
                selectedId={selectedId}
                compact={compact}
                onSelect={selectTask}
                onOpen={setDialogId}
                onToggle={(id) =>
                  apply((p) => ops.updateTask(p, id, { collapsed: !p.tasks.find((t) => t.id === id)!.collapsed }))
                }
                onRename={(id, name) => apply((p) => ops.updateTask(p, id, { name }))}
                onSetStart={(id, start) => apply((p) => ops.updateTask(p, id, { start }))}
                onSetEnd={(id, iso) => setEndExclusive(id, parseDate(iso) + 1)}
                onSetDuration={(id, duration) => apply((p) => ops.updateTask(p, id, { duration }))}
                onSetProgress={(id, progress) => apply((p) => ops.updateTask(p, id, { progress }))}
              />
              <GanttChart
                project={project}
                schedule={schedule}
                axis={axis}
                today={today}
                selectedId={selectedId}
                selectedDepId={selectedDepId}
                showCritical={showCritical}
                onSelect={selectTask}
                onSelectDep={(id) => {
                  setSelectedDepId(id);
                  setSelectedId(null);
                }}
                onOpen={setDialogId}
                onMove={(id, days) => {
                  const c = schedule.byId.get(id)!;
                  if (c.isSummary) apply((p) => ops.shiftTask(p, id, days));
                  else {
                    // Move from where the bar is drawn, which may already be pushed by a link.
                    const start = formatDate(c.startDay + days);
                    apply((p) => ops.updateTask(p, id, { start }));
                  }
                }}
                onResize={setEndExclusive}
                onLink={(from, to) => apply((p) => ops.addDependency(p, from, to))}
              />
            </div>
            {project.tasks.length === 0 && (
              <div className="empty">
                <p>No tasks yet.</p>
                <button className="primary" onClick={addTask}>
                  + Add the first task
                </button>
                <button onClick={() => {
                    reset(sampleProject());
                    setOpened((n) => n + 1);
                  }}>Load the example plan</button>
              </div>
            )}
          </div>
        ) : (
          <ResourceView
            project={project}
            schedule={schedule}
            axis={axis}
            zoom={zoom}
            today={today}
            viewLeft={viewLeft}
            onAdd={() => commit(ops.addResource(project)[0])}
            onRename={(id, name) => apply((p) => ops.updateResource(p, id, { name }))}
            onRole={(id, role) => apply((p) => ops.updateResource(p, id, { role }))}
            onRemove={(id) => apply((p) => ops.removeResource(p, id))}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>
          {total.length} tasks · {doneShare}% complete
        </span>
        {project.tasks.length > 0 && (
          <span>
            {formatDate(schedule.projectStartDay)} → {formatDate(schedule.projectEndDay)}
          </span>
        )}
        {schedule.hasCycle && <span className="warn">Some links form a loop and were ignored.</span>}
        <span className="hint">
          {TOUCH
            ? "Tap a bar to select it, then drag to move · drag its edge to resize · drag the dot to link · Edit… for details"
            : "Drag bars to move · drag the right edge to resize · drag the dot to link · double-click to edit"}
        </span>
      </footer>

      {dialogId && (
        <TaskDialog
          key={dialogId}
          project={project}
          schedule={schedule}
          taskId={dialogId}
          onSave={saveDialog}
          onClose={() => setDialogId(null)}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
