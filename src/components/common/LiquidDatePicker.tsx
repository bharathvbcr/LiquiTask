import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Popover } from "./Popover";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function toDateOnlyString(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDateOnlyString(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function getMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function formatDisplayDate(value: string) {
  const parsed = parseDateOnlyString(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface LiquidDateCalendarProps {
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
  className?: string;
}

export const LiquidDateCalendar: React.FC<LiquidDateCalendarProps> = ({
  value,
  onChange,
  onClose,
  className = "",
}) => {
  const selected = parseDateOnlyString(value);
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewMonth, setViewMonth] = useState(() => selected ?? today);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is a new Date reference derived from `value` every render — depending on it instead of `value` would re-fire this effect on every render
  useEffect(() => {
    if (selected) setViewMonth(selected);
  }, [value]);

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const days = useMemo(
    () => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()),
    [viewMonth],
  );

  const selectDate = useCallback(
    (date: Date) => {
      onChange(toDateOnlyString(date));
      onClose?.();
    },
    [onChange, onClose],
  );

  const shiftMonth = (delta: number) => {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  return (
    <div className={`liquid-glass rounded-2xl border border-white/10 p-4 shadow-2xl ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold tracking-wide text-slate-200">{monthLabel}</div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-1">
        {[
          { label: "Today", date: today },
          { label: "Tomorrow", date: addDays(today, 1) },
          { label: "Next Week", date: addDays(today, 7) },
        ].map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            onClick={() => selectDate(shortcut.date)}
            className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-200"
          >
            {shortcut.label}
          </button>
        ))}
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="py-1 text-center text-[10px] font-bold uppercase tracking-widest text-slate-500"
          >
            {label}
          </div>
        ))}
      </div>

      <div role="grid" aria-label={monthLabel} className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = day.getMonth() === viewMonth.getMonth();
          const isSelected = selected ? isSameDay(day, selected) : false;
          const isToday = isSameDay(day, today);
          const isPast = day < today;

          return (
            <button
              key={toDateOnlyString(day)}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => selectDate(day)}
              className={`
                flex h-9 w-9 items-center justify-center rounded-full text-sm transition-all
                ${inMonth ? "text-slate-200" : "text-slate-600"}
                ${isSelected ? "bg-red-500 text-white shadow-[0_0_16px_rgba(239,68,68,0.35)]" : "hover:bg-white/10"}
                ${isToday && !isSelected ? "ring-1 ring-red-500/50" : ""}
                ${isPast && !isSelected ? "opacity-70" : ""}
              `}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            onClose?.();
          }}
          className="mt-3 w-full rounded-xl px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
        >
          Clear Date
        </button>
      )}
    </div>
  );
};

export interface LiquidDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
}

export const LiquidDatePicker: React.FC<LiquidDatePickerProps> = ({
  value,
  onChange,
  className = "",
  id,
  "aria-label": ariaLabel = "Select due date",
  placeholder = "Pick a date",
}) => {
  const [open, setOpen] = useState(false);
  const displayValue = value ? formatDisplayDate(value) : placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      className={`block w-full ${className}`}
      contentClassName="animate-in fade-in zoom-in-95 duration-200"
      trigger={
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm liquid-input transition-colors hover:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        >
          <span className={value ? "text-slate-200" : "text-slate-500"}>{displayValue}</span>
          <Calendar size={16} className="shrink-0 text-slate-500" aria-hidden="true" />
        </button>
      }
    >
      <LiquidDateCalendar value={value} onChange={onChange} onClose={() => setOpen(false)} />
    </Popover>
  );
};
