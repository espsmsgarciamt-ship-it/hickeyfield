import { formatDate } from "../calendar";
import type { Project } from "../model";
import type { Schedule } from "../schedule";
import { CommitInput } from "./CommitInput";
import { ROW_H } from "./timeline";

export const GRID_COLUMNS = [
  { key: "wbs", label: "#", width: 44 },
  { key: "name", label: "Task", width: 220 },
  { key: "start", label: "Start", width: 128 },
  { key: "end", label: "End", width: 128 },
  { key: "dur", label: "Days", width: 52 },
  { key: "pct", label: "%", width: 50 },
  { key: "res", label: "Assigned", width: 110 },
] as const;
export const GRID_WIDTH = GRID_COLUMNS.reduce((s, c) => s + c.width, 0);

export interface GridHandlers {
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSetStart: (id: string, iso: string) => void;
  onSetEnd: (id: string, iso: string) => void;
  onSetDuration: (id: string, days: number) => void;
  onSetProgress: (id: string, pct: number) => void;
}

export function GridHeader() {
  return (
    <div className="grid-head" style={{ width: GRID_WIDTH }}>
      {GRID_COLUMNS.map((c) => (
        <div key={c.key} className={`cell col-${c.key}`} style={{ width: c.width }}>
          {c.label}
        </div>
      ))}
    </div>
  );
}

export function TaskGrid({
  project,
  schedule,
  selectedId,
  ...h
}: { project: Project; schedule: Schedule; selectedId: string | null } & GridHandlers) {
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const resNames = new Map(project.resources.map((r) => [r.id, r.name]));
  return (
    <div className="grid-body" style={{ width: GRID_WIDTH }}>
      {schedule.visible.map((id) => {
        const t = byId.get(id)!;
        const c = schedule.byId.get(id)!;
        const w = (k: string) => GRID_COLUMNS.find((x) => x.key === k)!.width;
        const fixed = c.isSummary;
        return (
          <div
            key={id}
            className={`grid-row${selectedId === id ? " selected" : ""}${c.isSummary ? " summary" : ""}`}
            style={{ height: ROW_H }}
            onMouseDown={() => h.onSelect(id)}
            onDoubleClick={(e) => {
              if ((e.target as HTMLElement).tagName !== "INPUT") h.onOpen(id);
            }}
          >
            <div className="cell col-wbs" style={{ width: w("wbs") }}>
              {c.wbs}
            </div>
            <div className="cell col-name" style={{ width: w("name"), paddingLeft: 4 + c.depth * 16 }}>
              {c.isSummary ? (
                <button
                  className="twisty"
                  aria-label={t.collapsed ? "Expand" : "Collapse"}
                  onClick={() => h.onToggle(id)}
                >
                  {t.collapsed ? "▸" : "▾"}
                </button>
              ) : (
                <span className={`dot${t.milestone ? " diamond" : ""}`} style={{ background: t.color }} />
              )}
              <CommitInput value={t.name} onCommit={(v) => h.onRename(id, v.trim() || t.name)} aria-label="Task name" />
            </div>
            <div className="cell" style={{ width: w("start") }}>
              {fixed ? (
                <span className="ro">{displayDate(c.startDay)}</span>
              ) : (
                <CommitInput
                  type="date"
                  value={formatDate(c.startDay)}
                  onCommit={(v) => h.onSetStart(id, v)}
                  className={c.constrained ? "constrained" : ""}
                  title={c.constrained ? "Pushed later by a dependency" : undefined}
                  aria-label="Start date"
                />
              )}
            </div>
            <div className="cell" style={{ width: w("end") }}>
              {fixed || t.milestone ? (
                <span className="ro">{displayDate(c.endDay)}</span>
              ) : (
                <CommitInput type="date" value={formatDate(c.endDay)} onCommit={(v) => h.onSetEnd(id, v)} aria-label="End date" />
              )}
            </div>
            <div className="cell num" style={{ width: w("dur") }}>
              {fixed || t.milestone ? (
                <span className="ro">{c.endIdx - c.startIdx}</span>
              ) : (
                <CommitInput
                  type="number"
                  min={1}
                  value={String(t.duration)}
                  onCommit={(v) => h.onSetDuration(id, Math.max(1, Math.round(Number(v)) || 1))}
                  aria-label="Duration in working days"
                />
              )}
            </div>
            <div className="cell num" style={{ width: w("pct") }}>
              {fixed ? (
                <span className="ro">{summaryProgress(project, schedule, id)}</span>
              ) : (
                <CommitInput
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={String(t.progress)}
                  onCommit={(v) => h.onSetProgress(id, Math.min(100, Math.max(0, Math.round(Number(v)) || 0)))}
                  aria-label="Percent complete"
                />
              )}
            </div>
            <div className="cell col-res" style={{ width: w("res") }} title={t.resourceIds.map((r) => resNames.get(r)).join(", ")}>
              {t.resourceIds.map((r) => resNames.get(r)).join(", ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Read-only dates in the same locale format the date inputs use. */
function displayDate(day: number): string {
  return dateFmt.format(new Date(day * 86_400_000));
}

/** Duration-weighted progress of the leaves under a summary. */
export function summaryProgress(project: Project, schedule: Schedule, id: string): number {
  let done = 0;
  let total = 0;
  const walk = (pid: string) => {
    for (const t of project.tasks) {
      if (t.parentId !== pid) continue;
      const c = schedule.byId.get(t.id)!;
      if (c.isSummary) walk(t.id);
      else {
        const w = Math.max(1, c.endIdx - c.startIdx);
        done += (t.progress / 100) * w;
        total += w;
      }
    }
  };
  walk(id);
  return total ? Math.round((done / total) * 100) : 0;
}
