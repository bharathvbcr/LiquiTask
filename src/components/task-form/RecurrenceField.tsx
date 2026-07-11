import { Repeat } from "lucide-react";
import type React from "react";
import type { RecurringConfig } from "../../../types";

interface RecurrenceFieldProps {
  recurring: RecurringConfig | undefined;
  setRecurring: React.Dispatch<React.SetStateAction<RecurringConfig | undefined>>;
}

export const RecurrenceField: React.FC<RecurrenceFieldProps> = ({ recurring, setRecurring }) => (
  <div className="space-y-2">
    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
      <Repeat size={12} /> Repeat
    </label>
    <div className="flex gap-2">
      <select
        value={recurring?.enabled ? recurring.frequency : "none"}
        onChange={(e) => {
          const value = e.target.value;
          if (value === "none") {
            setRecurring(recurring ? { ...recurring, enabled: false } : undefined);
          } else {
            setRecurring({
              enabled: true,
              frequency: value as RecurringConfig["frequency"],
              interval: recurring?.interval ?? 1,
              daysOfWeek: recurring?.daysOfWeek,
              dayOfMonth: recurring?.dayOfMonth,
              endDate: recurring?.endDate,
            });
          }
        }}
        className="flex-1 liquid-input rounded-xl px-4 py-3 text-sm bg-black/20"
        aria-label="Task recurrence"
      >
        <option value="none">Doesn&apos;t repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      {recurring?.enabled && (
        <input
          type="number"
          min={1}
          max={365}
          value={recurring.interval}
          onChange={(e) =>
            setRecurring({
              ...recurring,
              interval: Math.max(1, parseInt(e.target.value, 10) || 1),
            })
          }
          className="w-20 liquid-input rounded-xl px-3 py-3 text-sm text-center"
          aria-label="Repeat interval"
          title="Repeat every N periods"
        />
      )}
    </div>
    {recurring?.enabled && (
      <p className="text-[10px] text-slate-500 pl-1">
        Repeats every{" "}
        {recurring.interval > 1 ? `${recurring.interval} ` : ""}
        {recurring.frequency === "daily"
          ? recurring.interval > 1
            ? "days"
            : "day"
          : recurring.frequency === "weekly"
            ? recurring.interval > 1
              ? "weeks"
              : "week"
            : recurring.interval > 1
              ? "months"
              : "month"}{" "}
        once completed. A fresh copy lands in the backlog.
      </p>
    )}
  </div>
);
