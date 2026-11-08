import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Dependency, Project } from "../model";
import type { ComputedTask, Schedule } from "../schedule";
import { summaryProgress } from "./TaskGrid";
import { ROW_H, TimelineBackdrop, type Axis } from "./timeline";

type Mode = "move" | "resize" | "link";
interface Drag {
  id: string;
  mode: Mode;
  x0: number;
  dx: number;
  /** Pointer position in chart coordinates, for drawing a new link. */
  px: number;
  py: number;
  moved: boolean;
}

export interface ChartHandlers {
  onSelect: (id: string) => void;
  onSelectDep: (id: string) => void;
  onOpen: (id: string) => void;
  /** Move a task by whole calendar days. */
  onMove: (id: string, days: number) => void;
  /** New exclusive end day for a resized task. */
  onResize: (id: string, endExclusiveDay: number) => void;
  onLink: (from: string, to: string) => void;
}

const BAR_H = 18;
const BAR_Y = (ROW_H - BAR_H) / 2;

export function GanttChart({
  project,
  schedule,
  axis,
  today,
  selectedId,
  selectedDepId,
  showCritical,
  ...h
}: {
  project: Project;
  schedule: Schedule;
  axis: Axis;
  today: number;
  selectedId: string | null;
  selectedDepId: string | null;
  showCritical: boolean;
} & ChartHandlers) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const tasks = new Map(project.tasks.map((t) => [t.id, t]));
  const rowOf = new Map(schedule.visible.map((id, i) => [id, i]));
  const height = Math.max(schedule.visible.length * ROW_H, 120);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: ReactPointerEvent, id: string, mode: Mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    setDrag({ id, mode, x0: e.clientX, dx: 0, px: p.x, py: p.y, moved: false });
    h.onSelect(id);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = local(e);
    const dx = e.clientX - drag.x0;
    setDrag({ ...drag, dx, px: p.x, py: p.y, moved: drag.moved || Math.abs(dx) > 3 || drag.mode === "link" });
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    svgRef.current?.releasePointerCapture(e.pointerId);
    const days = Math.round(drag.dx / axis.px);
    const c = schedule.byId.get(drag.id)!;
    if (drag.mode === "link") {
      const target = schedule.visible[Math.floor(drag.py / ROW_H)];
      if (target && target !== drag.id) h.onLink(drag.id, target);
    } else if (drag.moved && days !== 0) {
      if (drag.mode === "move") h.onMove(drag.id, days);
      else h.onResize(drag.id, Math.max(c.startDay + 1, c.endDay + 1 + days));
    }
    setDrag(null);
  };

  const geometry = (c: ComputedTask) => {
    let x = axis.x(c.startDay);
    let w = c.endIdx > c.startIdx ? axis.x(c.endDay + 1) - x : 0;
    if (drag?.id === c.id && drag.moved) {
      const snap = Math.round(drag.dx / axis.px) * axis.px;
      if (drag.mode === "move") x += snap;
      if (drag.mode === "resize") w = Math.max(axis.px, w + snap);
    }
    // While a summary is dragged, show its children moving with it.
    if (drag?.mode === "move" && drag.moved && drag.id !== c.id && isUnder(c.id, drag.id)) {
      x += Math.round(drag.dx / axis.px) * axis.px;
    }
    return { x, w };
  };
  const isUnder = (id: string, ancestor: string) => {
    let cur = tasks.get(id)?.parentId;
    while (cur) {
      if (cur === ancestor) return true;
      cur = tasks.get(cur)?.parentId;
    }
    return false;
  };

  const anchors = (d: Dependency) => {
    const a = schedule.byId.get(d.from);
    const b = schedule.byId.get(d.to);
    const ra = rowOf.get(d.from);
    const rb = rowOf.get(d.to);
    if (!a || !b || ra === undefined || rb === undefined) return null;
    const ga = geometry(a);
    const gb = geometry(b);
    const fromEnd = d.type === "FS" || d.type === "FF";
    const toStart = d.type === "FS" || d.type === "SS";
    const pad = (c: ComputedTask) => (c.endIdx === c.startIdx ? 7 : 0);
    return {
      x1: fromEnd ? ga.x + ga.w + pad(a) : ga.x - pad(a),
      y1: ra * ROW_H + ROW_H / 2,
      x2: toStart ? gb.x - pad(b) : gb.x + gb.w + pad(b),
      y2: rb * ROW_H + ROW_H / 2,
      fromEnd,
      toStart,
    };
  };

  const depPath = (d: Dependency) => {
    const a = anchors(d);
    if (!a) return null;
    const out = a.fromEnd ? a.x1 + 8 : a.x1 - 8;
    const approach = a.toStart ? a.x2 - 8 : a.x2 + 8;
    const direct = a.toStart ? out <= approach : out >= approach;
    const yMid = a.y2 + (a.y1 < a.y2 ? -ROW_H / 2 : ROW_H / 2);
    return direct
      ? `M${a.x1},${a.y1} H${out} V${a.y2} H${a.x2}`
      : `M${a.x1},${a.y1} H${out} V${yMid} H${approach} V${a.y2} H${a.x2}`;
  };

  const criticalDep = (d: Dependency) =>
    showCritical && schedule.byId.get(d.from)?.critical && schedule.byId.get(d.to)?.critical;

  return (
    <svg
      ref={svgRef}
      className={`chart${drag?.moved ? " dragging" : ""}`}
      width={axis.width}
      height={height}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
        </marker>
        <marker id="arrow-crit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head crit" />
        </marker>
      </defs>

      {schedule.visible.map((id, i) => (
        <rect
          key={id}
          x={0}
          y={i * ROW_H}
          width={axis.width}
          height={ROW_H}
          className={`row-bg${i % 2 ? " odd" : ""}${selectedId === id ? " selected" : ""}`}
          onPointerDown={() => h.onSelect(id)}
        />
      ))}
      <TimelineBackdrop axis={axis} height={height} calendar={schedule.calendar} today={today} />

      {project.dependencies.map((d) => {
        const path = depPath(d);
        if (!path) return null;
        const crit = criticalDep(d);
        return (
          <g key={d.id} className={`dep${selectedDepId === d.id ? " selected" : ""}${crit ? " crit" : ""}`}>
            <path d={path} className="dep-line" markerEnd={`url(#${crit ? "arrow-crit" : "arrow"})`} />
            <path
              d={path}
              className="dep-hit"
              onPointerDown={(e) => {
                e.stopPropagation();
                h.onSelectDep(d.id);
              }}
            >
              <title>
                {tasks.get(d.from)?.name} → {tasks.get(d.to)?.name} ({d.type}
                {d.lag ? `, lag ${d.lag}` : ""})
              </title>
            </path>
          </g>
        );
      })}

      {schedule.visible.map((id, i) => {
        const t = tasks.get(id)!;
        const c = schedule.byId.get(id)!;
        const { x, w } = geometry(c);
        const y = i * ROW_H;
        const crit = showCritical && c.critical && !c.isSummary;
        const sel = selectedId === id;
        const label = t.name;
        const common = {
          onDoubleClick: () => h.onOpen(id),
          onPointerDown: (e: ReactPointerEvent) => start(e, id, "move"),
        };

        if (c.isSummary) {
          const pct = summaryProgress(project, schedule, id);
          return (
            <g key={id} className={`bar summary${sel ? " selected" : ""}`} {...common}>
              <rect x={x} y={y + 9} width={w} height={8} className="summary-bar" />
              <rect x={x} y={y + 9} width={(w * pct) / 100} height={8} className="summary-done" />
              <path d={`M${x},${y + 9} h8 l-8,10 z`} className="summary-bar" />
              <path d={`M${x + w},${y + 9} h-8 l8,10 z`} className="summary-bar" />
              <text x={x + w + 10} y={y + 19} className="bar-label strong">
                {label}
              </text>
              <title>{label}</title>
            </g>
          );
        }

        if (c.endIdx === c.startIdx) {
          const cx = x;
          const cy = y + ROW_H / 2;
          return (
            <g key={id} className={`bar milestone${sel ? " selected" : ""}${crit ? " crit" : ""}`} {...common}>
              <path d={`M${cx},${cy - 8} l8,8 l-8,8 l-8,-8 z`} style={{ fill: crit ? undefined : t.color }} className="ms" />
              <circle cx={cx + 14} cy={cy} r={4.5} className="knob" onPointerDown={(e) => start(e, id, "link")}>
                <title>Drag to another task to link</title>
              </circle>
              <text x={cx + 24} y={cy + 4} className="bar-label">
                {label}
              </text>
              <title>{label}</title>
            </g>
          );
        }

        const resNames = t.resourceIds
          .map((r) => project.resources.find((x) => x.id === r)?.name)
          .filter(Boolean)
          .join(", ");
        return (
          <g key={id} className={`bar task${sel ? " selected" : ""}${crit ? " crit" : ""}`} {...common}>
            <rect x={x} y={y + BAR_Y} width={w} height={BAR_H} rx={4} className="bar-fill" style={{ fill: crit ? undefined : t.color }} />
            {t.progress > 0 && (
              <rect x={x} y={y + BAR_Y} width={(w * t.progress) / 100} height={BAR_H} rx={4} className="bar-progress" />
            )}
            <rect
              x={x + w - 6}
              y={y + BAR_Y}
              width={8}
              height={BAR_H}
              className="resize"
              onPointerDown={(e) => start(e, id, "resize")}
            >
              <title>Drag to change duration</title>
            </rect>
            <circle cx={x + w + 9} cy={y + ROW_H / 2} r={4.5} className="knob" onPointerDown={(e) => start(e, id, "link")}>
              <title>Drag to another task to link</title>
            </circle>
            <text x={x + w + 18} y={y + 19} className="bar-label">
              {resNames || (w < 60 ? label : "")}
            </text>
            {w >= 60 && (
              <text x={x + 6} y={y + 19} className="bar-inner">
                {fitText(label, w - 12)}
              </text>
            )}
            <title>
              {label} — {t.progress}% done{c.slack > 0 ? `, ${c.slack} days of slack` : c.critical ? ", critical" : ""}
            </title>
          </g>
        );
      })}

      {drag?.mode === "link" && (() => {
        const c = schedule.byId.get(drag.id);
        const r = rowOf.get(drag.id);
        if (!c || r === undefined) return null;
        const g = geometry(c);
        return (
          <line
            x1={g.x + g.w + 9}
            y1={r * ROW_H + ROW_H / 2}
            x2={drag.px}
            y2={drag.py}
            className="link-preview"
            markerEnd="url(#arrow)"
          />
        );
      })()}
    </svg>
  );
}

function fitText(s: string, px: number): string {
  const max = Math.floor(px / 6.6);
  return s.length <= max ? s : max > 2 ? s.slice(0, max - 1) + "…" : "";
}
