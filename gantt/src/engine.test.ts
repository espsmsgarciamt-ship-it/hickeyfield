// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { formatDate, makeCalendar, parseDate, weekday } from "./calendar";
import { emptyProject, newTask, type DepType, type Project, type Task } from "./model";
import {
  addDependency,
  addSubtask,
  addTask,
  canLink,
  deleteTask,
  indent,
  move,
  outdent,
  setPredecessors,
  shiftTask,
} from "./project";
import { computeSchedule } from "./schedule";
import { importGan, normalizeProject, sampleProject, serializeProject, toCSV } from "./io";

// 2026-11-09 is a Monday.
const MON = "2026-11-09";

function plan(tasks: Partial<Task>[], deps: [number, number, DepType?, number?][] = [], weekends = false): Project {
  const p = emptyProject();
  p.workWeekends = weekends;
  p.tasks = tasks.map((t, i) => newTask({ id: `t${i}`, name: `T${i}`, start: MON, ...t }));
  p.dependencies = deps.map(([a, b, type = "FS", lag = 0], i) => ({ id: `d${i}`, from: `t${a}`, to: `t${b}`, type, lag }));
  return p;
}
const span = (p: Project, i: number) => {
  const c = computeSchedule(p).byId.get(`t${i}`)!;
  return [formatDate(c.startDay), formatDate(c.endDay)];
};

describe("calendar", () => {
  it("round-trips dates and knows weekdays", () => {
    expect(formatDate(parseDate("2024-02-29"))).toBe("2024-02-29");
    expect(weekday(parseDate(MON))).toBe(1);
  });
  it("skips weekends in index space", () => {
    const cal = makeCalendar(false);
    const fri = parseDate("2026-11-13");
    const sat = fri + 1;
    expect(cal.toIndex(sat)).toBe(cal.toIndex(fri) + 1);
    expect(formatDate(cal.toDay(cal.toIndex(fri) + 1))).toBe("2026-11-16");
    expect(cal.isWorkday(sat)).toBe(false);
  });
});

describe("schedule", () => {
  it("spans working days and skips the weekend", () => {
    expect(span(plan([{ duration: 7 }]), 0)).toEqual([MON, "2026-11-17"]);
    expect(span(plan([{ duration: 7 }], [], true), 0)).toEqual([MON, "2026-11-15"]);
  });

  it("snaps a weekend start to Monday", () => {
    expect(span(plan([{ start: "2026-11-14", duration: 1 }]), 0)).toEqual(["2026-11-16", "2026-11-16"]);
  });

  it("pushes successors for each dependency type", () => {
    const base = [{ duration: 3 }, { duration: 2 }];
    expect(span(plan(base, [[0, 1, "FS"]]), 1)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(span(plan(base, [[0, 1, "FS", 2]]), 1)).toEqual(["2026-11-16", "2026-11-17"]);
    expect(span(plan(base, [[0, 1, "SS", 1]]), 1)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(span(plan(base, [[0, 1, "FF"]]), 1)).toEqual(["2026-11-10", "2026-11-11"]);
    // SF: finish no earlier than 3 working days after the predecessor starts
    // (exclusive end), i.e. the 2-day task runs Tue–Wed.
    expect(span(plan(base, [[0, 1, "SF", 3]]), 1)).toEqual(["2026-11-10", "2026-11-11"]);
  });

  it("never pulls a task earlier than its own start", () => {
    const p = plan([{ duration: 1 }, { duration: 1, start: "2026-11-20" }], [[0, 1]]);
    const c = computeSchedule(p).byId.get("t1")!;
    expect(formatDate(c.startDay)).toBe("2026-11-20");
    expect(c.constrained).toBe(false);
  });

  it("rolls summaries up and applies links to summaries", () => {
    const p = plan(
      [{ duration: 2 }, { duration: 1 }, { parentId: "t1", duration: 2 }, { parentId: "t1", duration: 4 }],
      [[0, 1]],
    );
    const s = computeSchedule(p);
    expect(s.byId.get("t1")!.isSummary).toBe(true);
    expect(s.byId.get("t2")!.wbs).toBe("2.1");
    expect(span(p, 2)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(span(p, 1)).toEqual(["2026-11-11", "2026-11-16"]);
  });

  it("finds the critical path", () => {
    // t0 (3d) → t2 (1d); t1 (1d) → t2 has 2 days of slack.
    const p = plan([{ duration: 3 }, { duration: 1 }, { duration: 1 }], [[0, 2], [1, 2]]);
    const s = computeSchedule(p);
    expect(s.byId.get("t0")!.critical).toBe(true);
    expect(s.byId.get("t2")!.critical).toBe(true);
    expect(s.byId.get("t1")!.critical).toBe(false);
    expect(s.byId.get("t1")!.slack).toBe(2);
  });

  it("treats milestones as zero length", () => {
    const p = plan([{ duration: 2 }, { milestone: true }], [[0, 1]]);
    expect(span(p, 1)).toEqual(["2026-11-11", "2026-11-11"]);
  });

  it("hides children of collapsed tasks", () => {
    const p = plan([{ collapsed: true }, { parentId: "t0" }, {}]);
    expect(computeSchedule(p).visible).toEqual(["t0", "t2"]);
  });
});

describe("editing", () => {
  it("adds tasks after a subtree and as subtasks", () => {
    let p = plan([{}, { parentId: "t0" }, {}]);
    let id: string;
    [p, id] = addTask(p, "t0");
    expect(p.tasks.map((t) => t.id)).toEqual(["t0", "t1", id, "t2"]);
    [p, id] = addSubtask(p, "t2");
    expect(p.tasks.at(-1)!.parentId).toBe("t2");
  });

  it("indents, outdents and moves whole subtrees", () => {
    let p = plan([{}, {}, { parentId: "t1" }, {}]);
    p = indent(p, "t1");
    expect(p.tasks.find((t) => t.id === "t1")!.parentId).toBe("t0");
    p = outdent(p, "t1");
    expect(p.tasks.map((t) => [t.id, t.parentId])).toEqual([["t0", null], ["t1", null], ["t2", "t1"], ["t3", null]]);
    p = move(p, "t1", -1);
    expect(p.tasks.map((t) => t.id)).toEqual(["t1", "t2", "t0", "t3"]);
    p = move(p, "t1", 1);
    expect(p.tasks.map((t) => t.id)).toEqual(["t0", "t1", "t2", "t3"]);
  });

  it("outdent places the task after its old parent's other children", () => {
    let p = plan([{}, { parentId: "t0" }, { parentId: "t0" }]);
    p = outdent(p, "t1");
    expect(p.tasks.map((t) => t.id)).toEqual(["t0", "t2", "t1"]);
  });

  it("deletes subtrees and their links", () => {
    let p = plan([{}, { parentId: "t0" }, {}], [[1, 2]]);
    p = deleteTask(p, "t0");
    expect(p.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(p.dependencies).toEqual([]);
  });

  it("refuses loops, self links and parent links", () => {
    const p = plan([{}, {}, { parentId: "t1" }], [[0, 1]]);
    expect(canLink(p, "t1", "t0")).toMatch(/loop/);
    expect(canLink(p, "t2", "t0")).toMatch(/loop/);
    expect(canLink(p, "t0", "t0")).toMatch(/itself/);
    expect(canLink(p, "t1", "t2")).toMatch(/subtasks/);
    expect(() => addDependency(p, "t1", "t0")).toThrow();
    expect(() => setPredecessors(p, "t0", [{ from: "t1", type: "FS", lag: 0 }])).toThrow(/loop/);
  });

  it("shifts a summary with all its children", () => {
    let p = plan([{}, { parentId: "t0" }, { parentId: "t0", start: "2026-11-10" }]);
    p = shiftTask(p, "t0", 7);
    expect(p.tasks.map((t) => t.start)).toEqual(["2026-11-16", "2026-11-16", "2026-11-17"]);
  });
});

describe("files", () => {
  it("round-trips JSON and repairs junk", () => {
    const p = sampleProject();
    expect(normalizeProject(JSON.parse(serializeProject(p)))).toEqual(p);
    const fixed = normalizeProject({ tasks: [{ id: "a", parentId: "missing", start: "bad", progress: 500 }] });
    expect(fixed.tasks[0].parentId).toBeNull();
    expect(fixed.tasks[0].progress).toBe(100);
    expect(() => normalizeProject({})).toThrow();
  });

  it("the sample plan schedules without loops", () => {
    expect(computeSchedule(sampleProject()).hasCycle).toBe(false);
  });

  it("exports CSV with predecessors", () => {
    const csv = toCSV(plan([{ name: "A, the first", duration: 2 }, { duration: 1 }], [[0, 1, "FS", 1]]));
    expect(csv.split("\n")[1]).toContain('"A, the first"');
    expect(csv.split("\n")[2]).toContain("1FS+1");
  });

  it("imports GanttProject .gan files", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Imported" version="3">
  <tasks>
    <task id="0" name="Phase" color="#8cb6ce" meeting="false" start="2026-11-09" duration="5" complete="0" expand="true">
      <task id="1" name="Step one" meeting="false" start="2026-11-09" duration="2" complete="50">
        <notes><![CDATA[Remember this]]></notes>
        <depend id="2" type="2" difference="1" hardness="Strong"/>
      </task>
      <task id="2" name="Done" meeting="true" start="2026-11-09" duration="0" complete="0"/>
    </task>
  </tasks>
  <resources><resource id="0" name="Dana" function="Default:0"/></resources>
  <allocations><allocation task-id="1" resource-id="0" load="100.0"/></allocations>
</project>`;
    const p = importGan(xml);
    expect(p.name).toBe("Imported");
    expect(p.tasks.map((t) => t.name)).toEqual(["Phase", "Step one", "Done"]);
    expect(p.tasks[1].parentId).toBe(p.tasks[0].id);
    expect(p.tasks[1].notes).toBe("Remember this");
    expect(p.tasks[2].milestone).toBe(true);
    expect(p.dependencies).toHaveLength(1);
    expect(p.dependencies[0]).toMatchObject({ type: "FS", lag: 1 });
    expect(p.tasks[1].resourceIds).toEqual([p.resources[0].id]);
    const s = computeSchedule(p);
    expect(formatDate(s.byId.get(p.tasks[2].id)!.startDay)).toBe("2026-11-12");
  });
});
