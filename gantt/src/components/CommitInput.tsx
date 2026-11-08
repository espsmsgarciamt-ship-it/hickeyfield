import { useState, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
};

/**
 * An input that edits locally and commits once — on Enter, blur or (for
 * date inputs) a picked value — so each edit is a single undo step. While
 * not being edited it always shows the live value.
 */
export function CommitInput({ value, onCommit, type, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (v: string | null) => {
    if (v !== null && v !== value) onCommit(v);
  };
  return (
    <input
      {...rest}
      type={type}
      value={draft ?? value}
      onChange={(e) => {
        const v = e.target.value;
        // A picked date commits at once; a year still being typed ("0002") does not.
        const year = Number(v.slice(0, 4));
        if (type === "date" && year >= 1900 && year <= 2200) {
          commit(v);
          setDraft(null);
        } else setDraft(v);
      }}
      onBlur={() => {
        commit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          // Blur after the reset so the stale draft is not committed.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
        e.stopPropagation();
      }}
    />
  );
}
