import { dateParts, firstOfMonth, MONTHS_SHORT, weekday, type Calendar } from "../calendar";

export type Zoom = "day" | "week" | "month";
export const PX_PER_DAY: Record<Zoom, number> = { day: 30, week: 11, month: 3.2 };
export const ROW_H = 30;
export const HEAD_H = 48;

export interface Axis {
  startDay: number;
  endDay: number;
  px: number;
  width: number;
  x: (day: number) => number;
}

export function makeAxis(startDay: number, endDay: number, px: number, minWidth: number): Axis {
  const minDays = Math.ceil(minWidth / px);
  const end = Math.max(endDay, startDay + minDays);
  return { startDay, endDay: end, px, width: (end - startDay) * px, x: (d) => (d - startDay) * px };
}

interface Cell {
  x: number;
  w: number;
  label: string;
  weekend?: boolean;
}

function monthCells(axis: Axis, labelFn: (y: number, m: number) => string): Cell[] {
  const cells: Cell[] = [];
  let { year, month } = dateParts(axis.startDay);
  let d = firstOfMonth(year, month);
  while (d < axis.endDay) {
    const next = firstOfMonth(month === 11 ? year + 1 : year, (month + 1) % 12);
    const a = Math.max(d, axis.startDay);
    const b = Math.min(next, axis.endDay);
    cells.push({ x: axis.x(a), w: (b - a) * axis.px, label: labelFn(year, month) });
    d = next;
    if (++month === 12) {
      month = 0;
      year++;
    }
  }
  return cells;
}

function yearCells(axis: Axis): Cell[] {
  const cells: Cell[] = [];
  let year = dateParts(axis.startDay).year;
  while (firstOfMonth(year, 0) < axis.endDay) {
    const a = Math.max(firstOfMonth(year, 0), axis.startDay);
    const b = Math.min(firstOfMonth(year + 1, 0), axis.endDay);
    cells.push({ x: axis.x(a), w: (b - a) * axis.px, label: String(year) });
    year++;
  }
  return cells;
}

export function headerRows(axis: Axis, zoom: Zoom): [Cell[], Cell[]] {
  if (zoom === "month") {
    return [yearCells(axis), monthCells(axis, (_, m) => MONTHS_SHORT[m])];
  }
  const top = monthCells(axis, (y, m) => `${MONTHS_SHORT[m]} ${y}`);
  const bottom: Cell[] = [];
  if (zoom === "day") {
    for (let d = axis.startDay; d < axis.endDay; d++) {
      const w = weekday(d);
      bottom.push({ x: axis.x(d), w: axis.px, label: String(dateParts(d).date), weekend: w === 0 || w === 6 });
    }
  } else {
    let d = axis.startDay - ((weekday(axis.startDay) + 6) % 7);
    for (; d < axis.endDay; d += 7) {
      const a = Math.max(d, axis.startDay);
      bottom.push({ x: axis.x(a), w: (Math.min(d + 7, axis.endDay) - a) * axis.px, label: String(dateParts(d).date) });
    }
  }
  return [top, bottom];
}

export function TimelineHeader({ axis, zoom }: { axis: Axis; zoom: Zoom }) {
  const [top, bottom] = headerRows(axis, zoom);
  const half = HEAD_H / 2;
  return (
    <svg className="timeline-head" width={axis.width} height={HEAD_H}>
      {top.map((c, i) => (
        <g key={`t${i}`}>
          <line x1={c.x} x2={c.x} y1={0} y2={half} className="tick" />
          <text x={c.x + 6} y={16} className="head-label">
            {c.w > 40 ? c.label : ""}
          </text>
        </g>
      ))}
      <line x1={0} x2={axis.width} y1={half} y2={half} className="tick" />
      {bottom.map((c, i) => (
        <g key={`b${i}`}>
          {c.weekend && <rect x={c.x} y={half} width={c.w} height={half} className="weekend" />}
          <line x1={c.x} x2={c.x} y1={half} y2={HEAD_H} className="tick" />
          <text
            x={c.x + (zoom === "day" ? c.w / 2 : 4)}
            y={half + 16}
            textAnchor={zoom === "day" ? "middle" : "start"}
            className="head-label small"
          >
            {c.w >= 14 ? c.label : ""}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Weekend shading and the today line, drawn behind the bars. */
export function TimelineBackdrop({
  axis,
  height,
  calendar,
  today,
}: {
  axis: Axis;
  height: number;
  calendar: Calendar;
  today: number;
}) {
  const weekends: number[] = [];
  if (!calendar.workWeekends && axis.px >= 8) {
    for (let d = axis.startDay; d < axis.endDay; d++) if (!calendar.isWorkday(d)) weekends.push(d);
  }
  return (
    <g>
      {weekends.map((d) => (
        <rect key={d} x={axis.x(d)} y={0} width={axis.px} height={height} className="weekend" />
      ))}
      {today >= axis.startDay && today < axis.endDay && (
        <line x1={axis.x(today)} x2={axis.x(today)} y1={0} y2={height} className="today" />
      )}
    </g>
  );
}
