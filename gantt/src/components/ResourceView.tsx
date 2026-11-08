import { formatDate } from "../calendar";
import type { Project } from "../model";
import type { Schedule } from "../schedule";
import { CommitInput } from "./CommitInput";
import { ROW_H, TimelineBackdrop, TimelineHeader, type Axis, type Zoom } from "./timeline";

export const RES_GRID_WIDTH = 420;

export function ResourceView({
  project,
  schedule,
  axis,
  zoom,
  today,
  onAdd,
  onRename,
  onRole,
  onRemove,
}: {
  project: Project;
  schedule: Schedule;
  axis: Axis;
  zoom: Zoom;
  today: number;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onRole: (id: string, role: string) => void;
  onRemove: (id: string) => void;
}) {
  const cal = schedule.calendar;
  // Per resource: working-day index → names of tasks occupying it.
  const load = project.resources.map((r) => {
    const days = new Map<number, string[]>();
    for (const t of project.tasks) {
      const c = schedule.byId.get(t.id)!;
      if (c.isSummary || !t.resourceIds.includes(r.id)) continue;
      for (let i = c.startIdx; i < c.endIdx; i++) days.set(i, [...(days.get(i) ?? []), t.name]);
    }
    return days;
  });
  const height = Math.max(project.resources.length * ROW_H, 120);

  return (
    <div className="sheet" style={{ width: RES_GRID_WIDTH + axis.width }}>
      <div className="head-row">
        <div className="grid-head" style={{ width: RES_GRID_WIDTH }}>
          <div className="cell" style={{ width: 170 }}>Person</div>
          <div className="cell" style={{ width: 140 }}>Role</div>
          <div className="cell num" style={{ width: 70 }}>Tasks</div>
          <div className="cell" style={{ width: 40 }} />
        </div>
        <TimelineHeader axis={axis} zoom={zoom} />
      </div>
      <div className="body-row">
        <div className="grid-body" style={{ width: RES_GRID_WIDTH }}>
          {project.resources.map((r) => (
            <div key={r.id} className="grid-row" style={{ height: ROW_H }}>
              <div className="cell" style={{ width: 170 }}>
                <CommitInput value={r.name} onCommit={(v) => onRename(r.id, v.trim() || r.name)} aria-label="Name" />
              </div>
              <div className="cell" style={{ width: 140 }}>
                <CommitInput value={r.role} placeholder="Role" onCommit={(v) => onRole(r.id, v.trim())} aria-label="Role" />
              </div>
              <div className="cell num" style={{ width: 70 }}>
                <span className="ro">{project.tasks.filter((t) => t.resourceIds.includes(r.id)).length}</span>
              </div>
              <div className="cell" style={{ width: 40 }}>
                <button className="icon" aria-label={`Remove ${r.name}`} onClick={() => onRemove(r.id)}>
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="grid-row add-row" style={{ height: ROW_H }}>
            <button className="ghost" onClick={onAdd}>
              + Add person
            </button>
          </div>
        </div>
        <svg className="chart" width={axis.width} height={height}>
          {project.resources.map((r, i) => (
            <rect key={r.id} x={0} y={i * ROW_H} width={axis.width} height={ROW_H} className={`row-bg${i % 2 ? " odd" : ""}`} />
          ))}
          <TimelineBackdrop axis={axis} height={height} calendar={cal} today={today} />
          {load.map((days, i) =>
            [...days].map(([idx, names]) => {
              const day = cal.toDay(idx);
              const over = names.length > 1;
              return (
                <g key={`${i}-${idx}`}>
                  <rect
                    x={axis.x(day) + 0.5}
                    y={i * ROW_H + 6}
                    width={Math.max(1, axis.px - 1)}
                    height={ROW_H - 12}
                    rx={2}
                    className={`load${over ? " over" : ""}`}
                  >
                    <title>
                      {formatDate(day)}: {names.join(", ")}
                      {over ? " — overallocated" : ""}
                    </title>
                  </rect>
                  {over && axis.px >= 16 && (
                    <text x={axis.x(day) + axis.px / 2} y={i * ROW_H + 19} textAnchor="middle" className="load-count">
                      {names.length}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
      </div>
    </div>
  );
}
