import { useCallback, useReducer } from "react";
import type { Project } from "./model";

const LIMIT = 200;

interface State {
  past: Project[];
  present: Project;
  future: Project[];
}

type Action =
  | { type: "commit"; next: Project }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; project: Project };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "commit":
      if (a.next === s.present) return s;
      return { past: [...s.past, s.present].slice(-LIMIT), present: a.next, future: [] };
    case "undo":
      if (!s.past.length) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] };
    case "redo":
      if (!s.future.length) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) };
    case "reset":
      return { past: [], present: a.project, future: [] };
  }
}

export function useHistory(initial: () => Project) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ past: [], present: initial(), future: [] }));
  return {
    project: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: useCallback((next: Project) => dispatch({ type: "commit", next }), []),
    undo: useCallback(() => dispatch({ type: "undo" }), []),
    redo: useCallback(() => dispatch({ type: "redo" }), []),
    reset: useCallback((project: Project) => dispatch({ type: "reset", project }), []),
  };
}
