/** Dependency types, named after the two ends they tie together. */
export type DepType = "FS" | "SS" | "FF" | "SF";

export const DEP_LABELS: Record<DepType, string> = {
  FS: "Finish → Start",
  SS: "Start → Start",
  FF: "Finish → Finish",
  SF: "Start → Finish",
};

export interface Task {
  id: string;
  name: string;
  /** Earliest the task may start (ISO date). Dependencies can push it later. */
  start: string;
  /** Length in working days. Ignored for milestones and summary tasks. */
  duration: number;
  /** 0–100. */
  progress: number;
  parentId: string | null;
  milestone: boolean;
  color: string;
  resourceIds: string[];
  notes: string;
  collapsed: boolean;
}

export interface Dependency {
  id: string;
  /** Predecessor task id. */
  from: string;
  /** Successor task id. */
  to: string;
  type: DepType;
  /** Working days; may be negative (lead). */
  lag: number;
}

export interface Resource {
  id: string;
  name: string;
  role: string;
}

export interface Project {
  version: 1;
  name: string;
  /** When true, Saturdays and Sundays count as working days. */
  workWeekends: boolean;
  /** Tasks in display order (pre-order: a parent precedes its children). */
  tasks: Task[];
  dependencies: Dependency[];
  resources: Resource[];
}

export const TASK_COLORS = [
  "#4f7cff",
  "#18a999",
  "#f2a33a",
  "#9b6bff",
  "#e5577c",
  "#5b8a3c",
  "#7a8699",
];

let counter = 0;
export function uid(prefix = "t"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export function newTask(partial: Partial<Task> = {}): Task {
  return {
    id: uid("t"),
    name: "New task",
    start: todayISO(),
    duration: 1,
    progress: 0,
    parentId: null,
    milestone: false,
    color: TASK_COLORS[0],
    resourceIds: [],
    notes: "",
    collapsed: false,
    ...partial,
  };
}

export function emptyProject(name = "Untitled project"): Project {
  return { version: 1, name, workWeekends: false, tasks: [], dependencies: [], resources: [] };
}

export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
