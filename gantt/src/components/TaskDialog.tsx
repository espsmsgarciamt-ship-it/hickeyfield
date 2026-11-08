import { useEffect, useRef, useState } from "react";
import { isValidISODate } from "../calendar";
import { DEP_LABELS, TASK_COLORS, type DepType, type Project, type Task } from "../model";
import type { Schedule } from "../schedule";

interface PredDraft {
  from: string;
  type: DepType;
  lag: number;
}

export interface TaskEdit {
  task: Task;
  preds: PredDraft[];
}

export function TaskDialog({
  project,
  schedule,
  taskId,
  onSave,
  onClose,
}: {
  project: Project;
  schedule: Schedule;
  taskId: string;
  /** Returns an error message, or null on success. */
  onSave: (edit: TaskEdit) => string | null;
  onClose: () => void;
}) {
  const original = project.tasks.find((t) => t.id === taskId)!;
  const [task, setTask] = useState<Task>(original);
  const [preds, setPreds] = useState<PredDraft[]>(() =>
    project.dependencies.filter((d) => d.to === taskId).map(({ from, type, lag }) => ({ from, type, lag })),
  );
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const computed = schedule.byId.get(taskId)!;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setTask((t) => ({ ...t, [k]: v }));
  const others = project.tasks.filter((t) => t.id !== taskId);
  const wbs = (id: string) => schedule.byId.get(id)?.wbs ?? "";

  const save = () => {
    if (!task.name.trim()) return setError("Give the task a name.");
    if (!isValidISODate(task.start)) return setError("Pick a valid start date.");
    const err = onSave({ task: { ...task, name: task.name.trim() }, preds });
    if (err) setError(err);
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <header>
          <h2>Task {computed.wbs}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="form-grid">
          <label className="span2">
            Name
            <input autoFocus value={task.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            Start no earlier than
            <input type="date" value={task.start} disabled={computed.isSummary} onChange={(e) => set("start", e.target.value)} />
          </label>
          <label>
            Duration (working days)
            <input
              type="number"
              min={1}
              value={task.duration}
              disabled={computed.isSummary || task.milestone}
              onChange={(e) => set("duration", Math.max(1, Math.round(Number(e.target.value)) || 1))}
            />
          </label>
          <label>
            Progress (%)
            <input
              type="number"
              min={0}
              max={100}
              step={5}
              value={task.progress}
              disabled={computed.isSummary}
              onChange={(e) => set("progress", Math.min(100, Math.max(0, Math.round(Number(e.target.value)) || 0)))}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={task.milestone}
              disabled={computed.isSummary}
              onChange={(e) => set("milestone", e.target.checked)}
            />
            Milestone
          </label>
          <div className="span2">
            <span className="label">Colour</span>
            <div className="swatches">
              {TASK_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch${task.color === c ? " on" : ""}`}
                  style={{ background: c }}
                  aria-label={`Colour ${c}`}
                  onClick={() => set("color", c)}
                />
              ))}
            </div>
          </div>
        </div>

        <section>
          <h3>Assigned to</h3>
          {project.resources.length === 0 ? (
            <p className="muted">No people yet — add them on the Resources tab.</p>
          ) : (
            <div className="chips">
              {project.resources.map((r) => {
                const on = task.resourceIds.includes(r.id);
                return (
                  <label key={r.id} className={`chip${on ? " on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        set("resourceIds", on ? task.resourceIds.filter((x) => x !== r.id) : [...task.resourceIds, r.id])
                      }
                    />
                    {r.name}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3>Predecessors</h3>
          {preds.length > 0 && (
            <table className="preds">
              <tbody>
                {preds.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        value={p.from}
                        onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                      >
                        {others.map((t) => (
                          <option key={t.id} value={t.id}>
                            {wbs(t.id)} {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={p.type}
                        onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, type: e.target.value as DepType } : x)))}
                      >
                        {(Object.keys(DEP_LABELS) as DepType[]).map((k) => (
                          <option key={k} value={k}>
                            {DEP_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="lag"
                        value={p.lag}
                        title="Lag in working days (negative for lead)"
                        onChange={(e) => setPreds(preds.map((x, j) => (j === i ? { ...x, lag: Math.round(Number(e.target.value)) || 0 } : x)))}
                      />
                    </td>
                    <td>
                      <button type="button" className="icon" aria-label="Remove" onClick={() => setPreds(preds.filter((_, j) => j !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            className="ghost"
            disabled={!others.length}
            onClick={() => setPreds([...preds, { from: others[0].id, type: "FS", lag: 0 }])}
          >
            + Add predecessor
          </button>
        </section>

        <section>
          <h3>Notes</h3>
          <textarea rows={3} value={task.notes} onChange={(e) => set("notes", e.target.value)} />
        </section>

        {error && <p className="error">{error}</p>}
        <footer>
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </footer>
      </form>
    </dialog>
  );
}
