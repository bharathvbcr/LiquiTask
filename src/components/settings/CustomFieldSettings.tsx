import { Check, Layers, Plus, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { CustomFieldDefinition, CustomFieldType } from "../../../types";

const FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "dropdown", label: "Dropdown" },
  { value: "url", label: "URL" },
  { value: "formula", label: "Formula" },
];

interface CustomFieldSettingsProps {
  customFields: CustomFieldDefinition[];
  onUpdateCustomFields: (fields: CustomFieldDefinition[]) => void;
  addToast: (message: string, type: "success" | "error" | "info") => void;
}

export const CustomFieldSettings: React.FC<CustomFieldSettingsProps> = ({
  customFields,
  onUpdateCustomFields,
  addToast,
}) => {
  const [localFields, setLocalFields] = useState<CustomFieldDefinition[]>(customFields);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setLocalFields(customFields);
  }, [customFields]);

  const handleAddField = () => {
    const newField: CustomFieldDefinition = {
      id: `field_${Date.now()}`,
      label: "New Field",
      type: "text",
    };
    setLocalFields([...localFields, newField]);
    setEditingId(newField.id);
  };

  const handleUpdateField = (id: string, updates: Partial<CustomFieldDefinition>) => {
    setLocalFields(localFields.map((field) => (field.id === id ? { ...field, ...updates } : field)));
  };

  const handleDeleteField = (id: string) => {
    setLocalFields(localFields.filter((field) => field.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleSave = () => {
    const valid = localFields.filter((field) => field.label.trim());
    if (valid.some((field) => field.type === "dropdown" && (!field.options || field.options.length === 0))) {
      addToast("Dropdown fields need at least one option", "error");
      return;
    }
    onUpdateCustomFields(valid);
    addToast(`Saved ${valid.length} custom field${valid.length === 1 ? "" : "s"}`, "success");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
            <Layers size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Custom Fields</h3>
            <p className="text-sm text-slate-400 mt-0.5">
              Define extra fields for tasks. They appear in forms and filters.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleAddField}
          className="px-3 py-1.5 text-xs font-medium text-white bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors border border-red-500/30 flex items-center gap-1.5 shrink-0"
        >
          <Plus size={14} />
          Add Field
        </button>
      </div>

      {localFields.length === 0 ? (
        <p className="text-sm text-slate-500 px-1">No custom fields yet. Add one to get started.</p>
      ) : (
        <div className="space-y-3">
          {localFields.map((field) => {
            const isEditing = editingId === field.id;
            return (
              <div
                key={field.id}
                className="group bg-white/5 border border-white/10 rounded-xl p-4 hover:border-white/20 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                        Label
                      </label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => handleUpdateField(field.id, { label: e.target.value })}
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-red-500/50 focus:outline-none"
                          placeholder="Field name"
                        />
                      ) : (
                        <span className="text-sm text-white font-medium">{field.label}</span>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                        Type
                      </label>
                      {isEditing ? (
                        <select
                          value={field.type}
                          onChange={(e) =>
                            handleUpdateField(field.id, {
                              type: e.target.value as CustomFieldType,
                              options: e.target.value === "dropdown" ? field.options ?? [""] : undefined,
                              formula: e.target.value === "formula" ? field.formula ?? "" : undefined,
                            })
                          }
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-red-500/50 focus:outline-none"
                        >
                          {FIELD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-400 capitalize">{field.type}</span>
                      )}
                    </div>

                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
                        {field.type === "dropdown"
                          ? "Options"
                          : field.type === "formula"
                            ? "Formula"
                            : "Details"}
                      </label>
                      {isEditing && field.type === "dropdown" ? (
                        <input
                          type="text"
                          value={(field.options ?? []).join(", ")}
                          onChange={(e) =>
                            handleUpdateField(field.id, {
                              options: e.target.value
                                .split(",")
                                .map((option) => option.trim())
                                .filter(Boolean),
                            })
                          }
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-red-500/50 focus:outline-none"
                          placeholder="Option 1, Option 2"
                        />
                      ) : isEditing && field.type === "formula" ? (
                        <input
                          type="text"
                          value={field.formula ?? ""}
                          onChange={(e) => handleUpdateField(field.id, { formula: e.target.value })}
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white font-mono focus:border-red-500/50 focus:outline-none"
                          placeholder="{{dueDate}} - {{today}}"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">
                          {field.type === "dropdown"
                            ? (field.options ?? []).join(", ") || "No options"
                            : field.type === "formula"
                              ? field.formula || "No formula"
                              : "—"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        aria-label="Done editing"
                      >
                        <Check size={16} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingId(field.id)}
                        className="px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteField(field.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      aria-label={`Delete ${field.label}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        <p className="text-xs text-slate-500">
          {localFields.length} field{localFields.length === 1 ? "" : "s"} defined
        </p>
        <button
          type="button"
          onClick={handleSave}
          className="px-6 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-400 rounded-lg transition-colors shadow-lg shadow-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Save Fields
        </button>
      </div>
    </div>
  );
};
