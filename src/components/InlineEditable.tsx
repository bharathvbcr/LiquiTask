import type React from "react";
import { useEffect, useRef, useState } from "react";
import { LiquidDateCalendar, parseDateOnlyString, toDateOnlyString } from "./common/LiquidDatePicker";
import { Popover } from "./common/Popover";

interface InlineEditableProps {
  value: string;
  onSave: (newValue: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  autoFocus?: boolean;
  /** Display mode: wrap up to 2 lines instead of single-line ellipsis. */
  wrap?: boolean;
}

export const InlineEditable: React.FC<InlineEditableProps> = ({
  value,
  onSave,
  onCancel,
  placeholder = "Enter value...",
  className = "",
  multiline = false,
  autoFocus = true,
  wrap = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const savedRef = useRef(false);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && autoFocus && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing, autoFocus]);

  const handleStartEdit = () => {
    savedRef.current = false;
    setIsEditing(true);
    setEditValue(value);
  };

  const handleSave = () => {
    savedRef.current = true;
    if (!editValue.trim()) {
      handleCancel();
      return;
    }
    if (editValue.trim() !== value) {
      onSave(editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
    onCancel?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Enter" && multiline && e.shiftKey) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (!savedRef.current) {
        handleSave();
      }
    }, 200);
  };

  if (isEditing) {
    const InputComponent = multiline ? "textarea" : "input";
    return (
      <InputComponent
        ref={inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className={`liquid-input w-full max-w-full min-w-0 rounded-xl px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-red-500/50 ${className}`}
        style={{ minHeight: multiline ? "80px" : "auto" }}
      />
    );
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`block min-w-0 max-w-full ${wrap ? "line-clamp-2 break-words" : "truncate"} cursor-text hover:bg-white/5 rounded px-1 py-0.5 transition-colors ${className}`}
      title={value || placeholder}
    >
      {value || <span className="text-slate-500 italic">{placeholder}</span>}
    </span>
  );
};

interface InlineSelectProps {
  value: string;
  options: Array<{ id: string; label: string; color?: string }>;
  onSave: (newValue: string) => void;
  className?: string;
}

export const InlineSelect: React.FC<InlineSelectProps> = ({
  value,
  options,
  onSave,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const currentOption = options.find((opt) => opt.id === value) ?? options[0] ?? { id: '', label: '—', color: undefined };

  const handleSelect = (optionId: string) => {
    if (optionId !== value) {
      onSave(optionId);
    }
    setIsOpen(false);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      className={className}
      contentClassName="min-w-[150px]"
      trigger={
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="flex w-full min-w-0 max-w-full items-center gap-1.5 px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer"
          style={currentOption.color ? { color: currentOption.color } : {}}
        >
          <span className="min-w-0 truncate text-xs font-medium">{currentOption.label}</span>
          <span className="shrink-0 text-[10px] opacity-50">▼</span>
        </button>
      }
    >
      <div
        role="listbox"
        className="liquid-glass max-h-[220px] overflow-y-auto rounded-xl p-1 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === value}
            onClick={(e) => {
              e.stopPropagation();
              handleSelect(option.id);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 rounded transition-colors text-left ${
              option.id === value ? "bg-red-500/20" : ""
            }`}
            style={option.color ? { color: option.color } : {}}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Popover>
  );
};

interface InlineDatePickerProps {
  value: Date | null;
  onSave: (date: Date | null) => void;
  className?: string;
}

export const InlineDatePicker: React.FC<InlineDatePickerProps> = ({
  value,
  onSave,
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dateValue = value ? toDateOnlyString(value) : "";

  const handleChange = (nextValue: string) => {
    if (!nextValue) {
      onSave(null);
      return;
    }
    const parsed = parseDateOnlyString(nextValue);
    if (parsed) onSave(parsed);
  };

  const formatDate = (date: Date | null): string => {
    if (!date) return "No date";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
      className={className}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label="Select due date"
          className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/10 transition-colors cursor-pointer text-xs"
        >
          <span>{formatDate(value)}</span>
          <span className="text-[10px] opacity-50">▼</span>
        </button>
      }
    >
      <div role="dialog" aria-label="Due date picker">
        <LiquidDateCalendar
          value={dateValue}
          onChange={handleChange}
          onClose={() => setIsOpen(false)}
        />
      </div>
    </Popover>
  );
};
