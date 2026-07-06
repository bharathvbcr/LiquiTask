import type React from "react";
import { useEffect, useState } from "react";

interface SubtaskTitleInputProps {
  subtask: { id: string; title: string; completed: boolean };
  onCommit: (id: string, title: string) => void;
}

export const SubtaskTitleInput: React.FC<SubtaskTitleInputProps> = ({ subtask, onCommit }) => {
  const [value, setValue] = useState(subtask.title);

  useEffect(() => { setValue(subtask.title); }, [subtask.title]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== subtask.title) {
      onCommit(subtask.id, trimmed);
    } else {
      setValue(subtask.title);
    }
  };

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      className={`bg-transparent border-none outline-none text-xs w-full p-0.5 rounded ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-300'}`}
    />
  );
};
