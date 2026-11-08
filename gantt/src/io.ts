import { formatDate, isValidISODate, makeCalendar, parseDate } from "./calendar";
import {
  emptyProject,
  TASK_COLORS,
  todayISO,
  uid,
  type Dependency,
  type DepType,
  type Project,
  type Resource,
  type Task,
} from "./model";
import { sanitize } from "./project";
import { computeSchedule } from "./schedule";

const STORAGE_KEY = "gantt-planner:project";
const DEP_TYPES: DepType[] = ["FS", "SS", "FF", "SF"];

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Validates and repairs a project from untrusted JSON. */
export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== "object") throw new Error("Not a project file.");
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.tasks)) throw new Error("Not a project file: no task list.");
  const ids = new Set<string>();
  const tasks: Task[] = [];
  for (const r of o.tasks as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    let id = str(r.id) || uid("t");
    if (ids.has(id)) id = uid("t");
    ids.add(id);
    const start = str(r.start);
    tasks.push({
      id,
      name: str(r.name, "Task"),
      start: isValidISODate(start) ? start : todayISO(),
      duration: Math.max(0, Math.round(num(r.duration, 1))),
      progress: Math.min(100, Math.max(0, Math.round(num(r.progress)))),
      parentId: typeof r.parentId === "string" ? r.parentId : null,
      milestone: r.milestone === true,
      color: /^#[0-9a-f]{6}$/i.test(str(r.color)) ? str(r.color) : TASK_COLORS[0],
      resourceIds: Array.isArray(r.resourceIds) ? r.resourceIds.filter((x): x is string => typeof x === "string") : [],
      notes: str(r.notes),
      collapsed: r.collapsed === true,
    });
  }
  // Parents must exist and precede their children; anything else becomes top level.
  const seen = new Set<string>();
  for (const t of tasks) {
    if (t.parentId && !seen.has(t.parentId)) t.parentId = null;
    seen.add(t.id);
  }
  const resources: Resource[] = Array.isArray(o.resources)
    ? (o.resources as Record<string, unknown>[])
        .filter((r) => r && typeof r === "object")
        .map((r) => ({ id: str(r.id) || uid("r"), name: str(r.name, "Person"), role: str(r.role) }))
    : [];
  const dependencies: Dependency[] = Array.isArray(o.dependencies)
    ? (o.dependencies as Record<string, unknown>[])
        .filter((d) => d && typeof d === "object")
        .map((d) => ({
          id: str(d.id) || uid("d"),
          from: str(d.from),
          to: str(d.to),
          type: DEP_TYPES.includes(d.type as DepType) ? (d.type as DepType) : "FS",
          lag: Math.round(num(d.lag)),
        }))
    : [];
  return sanitize({
    version: 1,
    name: str(o.name, "Untitled project"),
    workWeekends: o.workWeekends === true,
    tasks,
    dependencies,
    resources,
  });
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export function parseProjectFile(text: string, filename: string): Project {
  if (/\.gan$/i.test(filename) || text.trimStart().startsWith("<")) return importGan(text);
  return normalizeProject(JSON.parse(text));
}

/**
 * Imports a GanttProject (.gan) XML file: tasks with nesting, milestones,
 * progress, colours, notes, dependencies, resources and allocations.
 */
export function importGan(xml: string): Project {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That .gan file isn't valid XML.");
  const root = doc.documentElement;
  if (root.nodeName !== "project") throw new Error("Not a GanttProject file.");

  const p = emptyProject(root.getAttribute("name") || "Imported project");
  const ganType: Record<string, DepType> = { "1": "SS", "2": "FS", "3": "FF", "4": "SF" };
  const idMap = new Map<string, string>();
  const pendingDeps: { from: string; to: string; type: DepType; lag: number }[] = [];

  const walk = (el: Element, parentId: string | null) => {
    for (const child of Array.from(el.children)) {
      if (child.nodeName !== "task") continue;
      const ganId = child.getAttribute("id") ?? "";
      const id = uid("t");
      idMap.set(ganId, id);
      const start = child.getAttribute("start") ?? "";
      const color = child.getAttribute("color") ?? "";
      const notes = Array.from(child.children).find((c) => c.nodeName === "notes")?.textContent ?? "";
      p.tasks.push({
        id,
        name: child.getAttribute("name") || "Task",
        start: isValidISODate(start) ? start : todayISO(),
        duration: Math.max(0, parseInt(child.getAttribute("duration") ?? "1", 10) || 0),
        progress: Math.min(100, Math.max(0, parseInt(child.getAttribute("complete") ?? "0", 10) || 0)),
        parentId,
        milestone: child.getAttribute("meeting") === "true",
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : TASK_COLORS[0],
        resourceIds: [],
        notes: notes.trim(),
        collapsed: child.getAttribute("expand") === "false",
      });
      for (const dep of Array.from(child.children)) {
        if (dep.nodeName !== "depend") continue;
        pendingDeps.push({
          from: ganId,
          to: dep.getAttribute("id") ?? "",
          type: ganType[dep.getAttribute("type") ?? "2"] ?? "FS",
          lag: parseInt(dep.getAttribute("difference") ?? "0", 10) || 0,
        });
      }
      walk(child, id);
    }
  };
  const tasksEl = Array.from(root.children).find((c) => c.nodeName === "tasks");
  if (tasksEl) walk(tasksEl, null);

  for (const d of pendingDeps) {
    const from = idMap.get(d.from);
    const to = idMap.get(d.to);
    if (from && to) p.dependencies.push({ id: uid("d"), from, to, type: d.type, lag: d.lag });
  }

  const resMap = new Map<string, string>();
  for (const r of Array.from(root.getElementsByTagName("resource"))) {
    const id = uid("r");
    resMap.set(r.getAttribute("id") ?? "", id);
    p.resources.push({ id, name: r.getAttribute("name") || "Person", role: r.getAttribute("function") ?? "" });
  }
  for (const a of Array.from(root.getElementsByTagName("allocation"))) {
    const t = p.tasks.find((x) => x.id === idMap.get(a.getAttribute("task-id") ?? ""));
    const r = resMap.get(a.getAttribute("resource-id") ?? "");
    if (t && r && !t.resourceIds.includes(r)) t.resourceIds.push(r);
  }
  return normalizeProject(p);
}

export function toCSV(p: Project): string {
  const s = computeSchedule(p);
  const res = new Map(p.resources.map((r) => [r.id, r.name]));
  const wbs = (id: string) => s.byId.get(id)?.wbs ?? "";
  const esc = (v: string | number) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["WBS", "Name", "Start", "End", "Duration", "Progress", "Milestone", "Resources", "Predecessors"]];
  for (const t of p.tasks) {
    const c = s.byId.get(t.id)!;
    const preds = p.dependencies
      .filter((d) => d.to === t.id)
      .map((d) => `${wbs(d.from)}${d.type}${d.lag ? (d.lag > 0 ? "+" : "") + d.lag : ""}`)
      .join(" ");
    rows.push([
      c.wbs,
      t.name,
      formatDate(c.startDay),
      formatDate(c.endDay),
      String(c.endIdx - c.startIdx),
      String(t.progress),
      t.milestone ? "yes" : "",
      t.resourceIds.map((r) => res.get(r) ?? "").join("; "),
      preds,
    ]);
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

export function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function store(p: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(p));
  } catch {
    /* storage full or blocked: autosave is a convenience only */
  }
}

export function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "project";
}

/** A small example plan, anchored to the Monday of the current week. */
export function sampleProject(): Project {
  const cal = makeCalendar(false);
  const today = parseDate(todayISO());
  const monday = today - ((new Date(today * 86_400_000).getUTCDay() + 6) % 7);
  const at = (workdays: number) => formatDate(cal.toDay(cal.toIndex(monday) + workdays));
  const p = emptyProject("Website relaunch");
  const ana = { id: uid("r"), name: "Ana", role: "Project lead" };
  const ben = { id: uid("r"), name: "Ben", role: "Designer" };
  const chi = { id: uid("r"), name: "Chi", role: "Developer" };
  p.resources = [ana, ben, chi];
  const T = (name: string, start: number, duration: number, extra: Partial<Task> = {}): Task => ({
    id: uid("t"),
    name,
    start: at(start),
    duration,
    progress: 0,
    parentId: null,
    milestone: false,
    color: TASK_COLORS[0],
    resourceIds: [],
    notes: "",
    collapsed: false,
    ...extra,
  });
  const discovery = T("Discovery", 0, 1, { color: TASK_COLORS[1] });
  const interviews = T("Stakeholder interviews", 0, 3, { parentId: discovery.id, color: TASK_COLORS[1], progress: 100, resourceIds: [ana.id] });
  const audit = T("Content audit", 0, 4, { parentId: discovery.id, color: TASK_COLORS[1], progress: 60, resourceIds: [ben.id] });
  const brief = T("Brief signed off", 0, 0, { parentId: discovery.id, milestone: true, color: TASK_COLORS[1] });
  const design = T("Design", 0, 1, { color: TASK_COLORS[3] });
  const wire = T("Wireframes", 0, 4, { parentId: design.id, color: TASK_COLORS[3], progress: 20, resourceIds: [ben.id] });
  const visual = T("Visual design", 0, 5, { parentId: design.id, color: TASK_COLORS[3], resourceIds: [ben.id] });
  const build = T("Build", 0, 1, { color: TASK_COLORS[0] });
  const setup = T("Set up CMS", 4, 3, { parentId: build.id, resourceIds: [chi.id] });
  const templates = T("Page templates", 0, 6, { parentId: build.id, resourceIds: [chi.id] });
  const migrate = T("Migrate content", 0, 4, { parentId: build.id, resourceIds: [ana.id, chi.id] });
  const launch = T("Launch", 0, 1, { color: TASK_COLORS[2] });
  const qa = T("QA and fixes", 0, 3, { parentId: launch.id, color: TASK_COLORS[2], resourceIds: [chi.id, ben.id] });
  const live = T("Go live", 0, 0, { parentId: launch.id, milestone: true, color: TASK_COLORS[2] });
  p.tasks = [discovery, interviews, audit, brief, design, wire, visual, build, setup, templates, migrate, launch, qa, live];
  const dep = (from: Task, to: Task, type: DepType = "FS", lag = 0): Dependency => ({ id: uid("d"), from: from.id, to: to.id, type, lag });
  p.dependencies = [
    dep(interviews, brief),
    dep(audit, brief),
    dep(brief, wire),
    dep(wire, visual, "SS", 2),
    dep(visual, templates),
    dep(setup, templates, "SS", 1),
    dep(templates, migrate, "SS", 2),
    dep(migrate, qa),
    dep(templates, qa),
    dep(qa, live),
  ];
  return p;
}
