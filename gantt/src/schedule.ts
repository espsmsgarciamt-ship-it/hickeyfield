import { makeCalendar, parseDate, type Calendar } from "./calendar";
import type { Dependency, Project, Task } from "./model";

export interface ComputedTask {
  id: string;
  depth: number;
  wbs: string;
  isSummary: boolean;
  /** Working-day indices; end is exclusive. */
  startIdx: number;
  endIdx: number;
  /** First calendar day of the task. */
  startDay: number;
  /** Last calendar day (inclusive). Equals startDay for zero-length tasks. */
  endDay: number;
  /** Working days of float before the project end moves. */
  slack: number;
  critical: boolean;
  /** True when a dependency pushed the task past its own start date. */
  constrained: boolean;
  /** Hidden because an ancestor is collapsed. */
  hidden: boolean;
}

export interface Schedule {
  calendar: Calendar;
  byId: Map<string, ComputedTask>;
  /** Task ids in display order, without hidden rows. */
  visible: string[];
  projectStartDay: number;
  projectEndDay: number;
  /** Dependencies that are part of a cycle and were ignored. */
  hasCycle: boolean;
}

export function taskDuration(t: Task): number {
  return t.milestone ? 0 : Math.max(0, Math.round(t.duration));
}

/** Map of parent id → child ids, in display order. */
export function childrenOf(tasks: Task[]): Map<string | null, string[]> {
  const map = new Map<string | null, string[]>();
  for (const t of tasks) {
    const list = map.get(t.parentId) ?? [];
    list.push(t.id);
    map.set(t.parentId, list);
  }
  return map;
}

export function ancestorsOf(id: string, byId: Map<string, Task>): string[] {
  const out: string[] = [];
  let cur = byId.get(id)?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

export function isAncestor(ancestorId: string, id: string, byId: Map<string, Task>): boolean {
  return ancestorsOf(id, byId).includes(ancestorId);
}

interface Graph {
  leaves: string[];
  leavesUnder: (id: string) => string[];
  /** For each leaf, the dependencies constraining it (on it or an ancestor). */
  incoming: Map<string, Dependency[]>;
  /** Leaves in topological order. Leaves stuck in a cycle are appended last. */
  order: string[];
  hasCycle: boolean;
}

function buildGraph(p: Project): Graph {
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const kids = childrenOf(p.tasks);
  const leaves = p.tasks.filter((t) => !kids.has(t.id)).map((t) => t.id);

  const leafMemo = new Map<string, string[]>();
  const leavesUnder = (id: string): string[] => {
    const hit = leafMemo.get(id);
    if (hit) return hit;
    const c = kids.get(id);
    const res = c ? c.flatMap(leavesUnder) : [id];
    leafMemo.set(id, res);
    return res;
  };

  const depsTo = new Map<string, Dependency[]>();
  for (const d of p.dependencies) {
    if (!byId.has(d.from) || !byId.has(d.to)) continue;
    const list = depsTo.get(d.to) ?? [];
    list.push(d);
    depsTo.set(d.to, list);
  }

  const incoming = new Map<string, Dependency[]>();
  const preds = new Map<string, Set<string>>();
  const succs = new Map<string, Set<string>>();
  for (const leaf of leaves) {
    preds.set(leaf, new Set());
    succs.set(leaf, new Set());
  }
  for (const leaf of leaves) {
    const targets = [leaf, ...ancestorsOf(leaf, byId)];
    const deps = targets.flatMap((t) => depsTo.get(t) ?? []);
    incoming.set(leaf, deps);
    for (const d of deps) {
      for (const pl of leavesUnder(d.from)) {
        if (pl === leaf) continue;
        preds.get(leaf)!.add(pl);
        succs.get(pl)!.add(leaf);
      }
    }
  }

  // Kahn's algorithm, stable with respect to display order.
  const indeg = new Map(leaves.map((l) => [l, preds.get(l)!.size]));
  const queue = leaves.filter((l) => indeg.get(l) === 0);
  const order: string[] = [];
  while (queue.length) {
    const l = queue.shift()!;
    order.push(l);
    for (const s of succs.get(l)!) {
      const n = indeg.get(s)! - 1;
      indeg.set(s, n);
      if (n === 0) queue.push(s);
    }
  }
  const hasCycle = order.length < leaves.length;
  if (hasCycle) {
    const placed = new Set(order);
    for (const l of leaves) if (!placed.has(l)) order.push(l);
  }
  return { leaves, leavesUnder, incoming, order, hasCycle };
}

export function hasCycle(p: Project): boolean {
  return buildGraph(p).hasCycle;
}

export function computeSchedule(p: Project): Schedule {
  const cal = makeCalendar(p.workWeekends);
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const kids = childrenOf(p.tasks);
  const g = buildGraph(p);
  const out = new Map<string, ComputedTask>();

  // Structure: depth, WBS numbering, visibility.
  const wbsCounter = new Map<string | null, number>();
  for (const t of p.tasks) {
    const n = (wbsCounter.get(t.parentId) ?? 0) + 1;
    wbsCounter.set(t.parentId, n);
    const parent = t.parentId ? out.get(t.parentId) : undefined;
    const parentTask = t.parentId ? byId.get(t.parentId) : undefined;
    out.set(t.id, {
      id: t.id,
      depth: parent ? parent.depth + 1 : 0,
      wbs: parent ? `${parent.wbs}.${n}` : String(n),
      isSummary: kids.has(t.id),
      startIdx: 0,
      endIdx: 0,
      startDay: 0,
      endDay: 0,
      slack: 0,
      critical: false,
      constrained: false,
      hidden: parent ? parent.hidden || !!parentTask?.collapsed : false,
    });
  }

  const span = (id: string): [number, number] => {
    const ls = g.leavesUnder(id);
    let s = Infinity;
    let e = -Infinity;
    for (const l of ls) {
      const c = out.get(l)!;
      s = Math.min(s, c.startIdx);
      e = Math.max(e, c.endIdx);
    }
    return [s, e];
  };

  // Forward pass: earliest start honouring every incoming dependency.
  // A leaf caught in a cycle keeps its own date for the offending links.
  const cyclic = new Set<string>();
  const done = new Set<string>();
  for (const leafId of g.order) {
    const t = byId.get(leafId)!;
    const c = out.get(leafId)!;
    const dur = taskDuration(t);
    const own = cal.toIndex(parseDate(t.start));
    let es = own;
    for (const d of g.incoming.get(leafId)!) {
      const predLeaves = g.leavesUnder(d.from).filter((l) => l !== leafId);
      if (!predLeaves.length) continue;
      if (predLeaves.some((l) => !done.has(l))) {
        cyclic.add(leafId);
        continue;
      }
      const [ps, pe] = span(d.from);
      es = Math.max(es, constraintStart(d, ps, pe, dur));
    }
    c.startIdx = es;
    c.endIdx = es + dur;
    c.constrained = es > own;
    done.add(leafId);
  }

  // Summaries roll up their children (reverse pre-order = children first).
  for (let i = p.tasks.length - 1; i >= 0; i--) {
    const t = p.tasks[i];
    const c = out.get(t.id)!;
    if (!c.isSummary) continue;
    const [s, e] = span(t.id);
    c.startIdx = s;
    c.endIdx = e;
  }

  // Backward pass: latest finish without moving the project end.
  let projectEndIdx = -Infinity;
  let projectStartIdx = Infinity;
  for (const l of g.leaves) {
    projectEndIdx = Math.max(projectEndIdx, out.get(l)!.endIdx);
    projectStartIdx = Math.min(projectStartIdx, out.get(l)!.startIdx);
  }
  const lateEnd = new Map(g.leaves.map((l) => [l, projectEndIdx]));
  for (let i = g.order.length - 1; i >= 0; i--) {
    const leafId = g.order[i];
    if (cyclic.has(leafId)) continue;
    const t = byId.get(leafId)!;
    const lf = lateEnd.get(leafId)!;
    const ls = lf - taskDuration(t);
    for (const d of g.incoming.get(leafId)!) {
      for (const pl of g.leavesUnder(d.from)) {
        if (pl === leafId) continue;
        const pdur = taskDuration(byId.get(pl)!);
        let bound: number;
        switch (d.type) {
          case "FS": bound = ls - d.lag; break;
          case "SS": bound = ls - d.lag + pdur; break;
          case "FF": bound = lf - d.lag; break;
          case "SF": bound = lf - d.lag + pdur; break;
        }
        lateEnd.set(pl, Math.min(lateEnd.get(pl)!, bound));
      }
    }
  }
  for (const l of g.leaves) {
    const c = out.get(l)!;
    c.slack = lateEnd.get(l)! - c.endIdx;
    c.critical = !cyclic.has(l) && c.slack <= 0;
  }
  for (let i = p.tasks.length - 1; i >= 0; i--) {
    const c = out.get(p.tasks[i].id)!;
    if (!c.isSummary) continue;
    c.slack = Math.min(...(kids.get(c.id) ?? []).map((k) => out.get(k)!.slack));
  }

  // Calendar days for display.
  for (const c of out.values()) {
    c.startDay = cal.toDay(c.startIdx);
    c.endDay = c.endIdx > c.startIdx ? cal.toDay(c.endIdx - 1) : c.startDay;
  }

  const visible = p.tasks.filter((t) => !out.get(t.id)!.hidden).map((t) => t.id);
  const hasTasks = g.leaves.length > 0;
  return {
    calendar: cal,
    byId: out,
    visible,
    projectStartDay: hasTasks ? cal.toDay(projectStartIdx) : 0,
    projectEndDay: hasTasks ? cal.toDay(Math.max(projectStartIdx, projectEndIdx - 1)) : 0,
    hasCycle: g.hasCycle || cyclic.size > 0,
  };
}

/** Earliest successor start allowed by one dependency. */
function constraintStart(d: Dependency, ps: number, pe: number, dur: number): number {
  switch (d.type) {
    case "FS": return pe + d.lag;
    case "SS": return ps + d.lag;
    case "FF": return pe + d.lag - dur;
    case "SF": return ps + d.lag - dur;
  }
}

