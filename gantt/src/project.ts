import { formatDate, parseDate } from "./calendar";
import {
  newTask,
  todayISO,
  uid,
  type Dependency,
  type DepType,
  type Project,
  type Resource,
  type Task,
} from "./model";
import { hasCycle, isAncestor } from "./schedule";

/** Thrown for edits that would break the plan; the message is user-facing. */
export class EditError extends Error {}

const index = (p: Project) => new Map(p.tasks.map((t) => [t.id, t]));

/** [start, end) range of a task and all its descendants in `tasks`. */
export function subtreeRange(tasks: Task[], id: string): [number, number] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0) return [-1, -1];
  let j = i + 1;
  while (j < tasks.length && isAncestor(id, tasks[j].id, byId)) j++;
  return [i, j];
}

function siblings(p: Project, id: string): string[] {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return [];
  return p.tasks.filter((x) => x.parentId === t.parentId).map((x) => x.id);
}

/** Drops dependencies that point at missing tasks or tie a task to its own ancestor. */
export function sanitize(p: Project): Project {
  const byId = index(p);
  const resIds = new Set(p.resources.map((r) => r.id));
  const dependencies = p.dependencies.filter(
    (d) =>
      d.from !== d.to &&
      byId.has(d.from) &&
      byId.has(d.to) &&
      !isAncestor(d.from, d.to, byId) &&
      !isAncestor(d.to, d.from, byId),
  );
  const tasks = p.tasks.map((t) =>
    t.resourceIds.every((r) => resIds.has(r))
      ? t
      : { ...t, resourceIds: t.resourceIds.filter((r) => resIds.has(r)) },
  );
  return { ...p, tasks, dependencies };
}

/** Rejects any edit result that contains a dependency loop. */
export function guard(p: Project): Project {
  const clean = sanitize(p);
  if (hasCycle(clean)) throw new EditError("That change would create a dependency loop.");
  return clean;
}

export function addTask(
  p: Project,
  afterId: string | null,
  partial: Partial<Task> = {},
): [Project, string] {
  const after = afterId ? p.tasks.find((t) => t.id === afterId) : undefined;
  const task = newTask({
    start: after ? after.start : todayISO(),
    parentId: after ? after.parentId : null,
    color: after?.color,
    ...partial,
  });
  const tasks = [...p.tasks];
  const at = after ? subtreeRange(tasks, after.id)[1] : tasks.length;
  tasks.splice(at, 0, task);
  return [{ ...p, tasks }, task.id];
}

export function addSubtask(p: Project, parentId: string): [Project, string] {
  const parent = p.tasks.find((t) => t.id === parentId);
  if (!parent) return addTask(p, null);
  const task = newTask({ start: parent.start, parentId, color: parent.color });
  const tasks = p.tasks.map((t) => (t.id === parentId ? { ...t, collapsed: false } : t));
  tasks.splice(subtreeRange(tasks, parentId)[1], 0, task);
  return [guard({ ...p, tasks }), task.id];
}

export function updateTask(p: Project, id: string, patch: Partial<Task>): Project {
  return { ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function deleteTask(p: Project, id: string): Project {
  const [a, b] = subtreeRange(p.tasks, id);
  if (a < 0) return p;
  const gone = new Set(p.tasks.slice(a, b).map((t) => t.id));
  return {
    ...p,
    tasks: p.tasks.filter((t) => !gone.has(t.id)),
    dependencies: p.dependencies.filter((d) => !gone.has(d.from) && !gone.has(d.to)),
  };
}

/** Makes the task the last child of its previous sibling. */
export function indent(p: Project, id: string): Project {
  const sib = siblings(p, id);
  const k = sib.indexOf(id);
  if (k <= 0) return p;
  const newParent = sib[k - 1];
  const tasks = p.tasks.map((t) =>
    t.id === id ? { ...t, parentId: newParent } : t.id === newParent ? { ...t, collapsed: false } : t,
  );
  return guard({ ...p, tasks });
}

/** Moves the task up one level, placing it right after its old parent. */
export function outdent(p: Project, id: string): Project {
  const t = p.tasks.find((x) => x.id === id);
  if (!t?.parentId) return p;
  const parent = p.tasks.find((x) => x.id === t.parentId)!;
  const [a, b] = subtreeRange(p.tasks, id);
  const block = p.tasks.slice(a, b).map((x) => (x.id === id ? { ...x, parentId: parent.parentId } : x));
  const rest = [...p.tasks.slice(0, a), ...p.tasks.slice(b)];
  const parentEnd = subtreeRange(rest, parent.id)[1];
  rest.splice(parentEnd, 0, ...block);
  return guard({ ...p, tasks: rest });
}

/** Swaps the task (with its subtree) with the neighbouring sibling. */
export function move(p: Project, id: string, dir: -1 | 1): Project {
  const sib = siblings(p, id);
  const k = sib.indexOf(id);
  const other = sib[k + dir];
  if (k < 0 || !other) return p;
  const [first, second] = dir < 0 ? [other, id] : [id, other];
  const [a1, b1] = subtreeRange(p.tasks, first);
  const [a2, b2] = subtreeRange(p.tasks, second);
  const tasks = [
    ...p.tasks.slice(0, a1),
    ...p.tasks.slice(a2, b2),
    ...p.tasks.slice(b1, a2),
    ...p.tasks.slice(a1, b1),
    ...p.tasks.slice(b2),
  ];
  return { ...p, tasks };
}

/** Shifts a task's start; for a summary, every task beneath it moves too. */
export function shiftTask(p: Project, id: string, days: number): Project {
  if (!days) return p;
  const [a, b] = subtreeRange(p.tasks, id);
  const ids = new Set(p.tasks.slice(a, b).map((t) => t.id));
  return {
    ...p,
    tasks: p.tasks.map((t) =>
      ids.has(t.id) ? { ...t, start: formatDate(parseDate(t.start) + days) } : t,
    ),
  };
}

export function canLink(p: Project, from: string, to: string): string | null {
  const byId = index(p);
  if (from === to) return "A task can't depend on itself.";
  if (!byId.has(from) || !byId.has(to)) return "Unknown task.";
  if (isAncestor(from, to, byId) || isAncestor(to, from, byId))
    return "A summary task can't be linked to its own subtasks.";
  if (p.dependencies.some((d) => d.from === from && d.to === to))
    return "Those tasks are already linked.";
  const trial = { ...p, dependencies: [...p.dependencies, { id: "?", from, to, type: "FS" as DepType, lag: 0 }] };
  if (hasCycle(trial)) return "That link would create a dependency loop.";
  return null;
}

export function addDependency(
  p: Project,
  from: string,
  to: string,
  type: DepType = "FS",
  lag = 0,
): Project {
  const err = canLink(p, from, to);
  if (err) throw new EditError(err);
  const dep: Dependency = { id: uid("d"), from, to, type, lag };
  return guard({ ...p, dependencies: [...p.dependencies, dep] });
}

export function removeDependency(p: Project, depId: string): Project {
  return { ...p, dependencies: p.dependencies.filter((d) => d.id !== depId) };
}

/** Replaces every dependency whose successor is `taskId`. */
export function setPredecessors(
  p: Project,
  taskId: string,
  preds: Omit<Dependency, "id" | "to">[],
): Project {
  const kept = p.dependencies.filter((d) => d.to !== taskId);
  const seen = new Set<string>();
  const added: Dependency[] = [];
  for (const d of preds) {
    if (!d.from || seen.has(d.from)) continue;
    seen.add(d.from);
    added.push({ id: uid("d"), to: taskId, from: d.from, type: d.type, lag: Math.round(d.lag) || 0 });
  }
  const next = { ...p, dependencies: [...kept, ...added] };
  const byId = index(next);
  for (const d of added) {
    if (d.from === taskId || isAncestor(d.from, taskId, byId) || isAncestor(taskId, d.from, byId))
      throw new EditError("A summary task can't be linked to its own subtasks.");
  }
  return guard(next);
}

export function addResource(p: Project, name = "New person", role = ""): [Project, string] {
  const r: Resource = { id: uid("r"), name, role };
  return [{ ...p, resources: [...p.resources, r] }, r.id];
}

export function updateResource(p: Project, id: string, patch: Partial<Resource>): Project {
  return { ...p, resources: p.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeResource(p: Project, id: string): Project {
  return sanitize({ ...p, resources: p.resources.filter((r) => r.id !== id) });
}
