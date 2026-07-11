import type React from "react";
import type { CustomFieldDefinition } from "../../../types";
import { Tooltip } from "../Tooltip";

interface CustomFieldsSectionProps {
  customFields: CustomFieldDefinition[];
  customValues: Record<string, string | number>;
  setCustomValues: React.Dispatch<React.SetStateAction<Record<string, string | number>>>;
}

export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({
  customFields,
  customValues,
  setCustomValues,
}) => {
  if (customFields.length === 0) return null;
  return (
    <div className="space-y-3 pt-2 border-t border-white/5">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
        Custom Fields
      </label>
      <div className="grid grid-cols-2 gap-6">
        {customFields.map((field) => (
          <div key={field.id} className="space-y-2">
            <label className="text-xs text-slate-500 font-semibold">{field.label}</label>
            {field.type === "dropdown" ? (
              <Tooltip content={`Select ${field.label}`} position="top">
                <select
                  value={customValues[field.id] || ""}
                  onChange={(e) =>
                    setCustomValues({
                      ...customValues,
                      [field.id]: e.target.value,
                    })
                  }
                  className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none"
                  aria-label={field.label}
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt} className="bg-navy-900">
                      {opt}
                    </option>
                  ))}
                </select>
              </Tooltip>
            ) : (
              <Tooltip content={`Enter ${field.label}`} position="top">
                <input
                  type={field.type === "number" ? "number" : "text"}
                  value={customValues[field.id] || ""}
                  onChange={(e) =>
                    setCustomValues({
                      ...customValues,
                      [field.id]: e.target.value,
                    })
                  }
                  className="w-full liquid-input rounded-xl px-4 py-3 text-sm"
                  placeholder={
                    field.type === "url"
                      ? "https://..."
                      : field.type === "number"
                        ? "Enter number..."
                        : `Enter ${field.label.toLowerCase()}...`
                  }
                  aria-label={field.label}
                />
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
