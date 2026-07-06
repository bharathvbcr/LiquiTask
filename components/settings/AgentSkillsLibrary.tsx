import { BookOpen, Download, Pencil, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

import agentSkillsService from "../../src/services/agents/agentSkillsService";
import type { AgentSkill, ToastType } from "../../types";

interface AgentSkillsLibraryProps {
  addToast: (msg: string, type: ToastType) => void;
}

export const AgentSkillsLibrary: React.FC<AgentSkillsLibraryProps> = ({ addToast }) => {
  const [skills, setSkills] = useState<AgentSkill[]>(() => agentSkillsService.getSkills());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSummary, setEditSummary] = useState("");

  const refresh = useCallback(() => {
    setSkills(agentSkillsService.getSkills());
  }, []);

  const handleDelete = async (id: string) => {
    await agentSkillsService.deleteSkill(id);
    refresh();
    addToast("Skill removed", "info");
  };

  const handleSaveEdit = async (skill: AgentSkill) => {
    const all = agentSkillsService.getSkills();
    const next = all.map((s) => (s.id === skill.id ? { ...s, summary: editSummary } : s));
    const { default: storageService } = await import("../../src/services/storageService");
    const { STORAGE_KEYS } = await import("../../src/constants");
    await storageService.set(STORAGE_KEYS.AGENT_SKILLS, next);
    setEditingId(null);
    refresh();
    addToast("Skill updated", "success");
  };

  const exportToClaudeMd = () => {
    const byDir = new Map<string, AgentSkill[]>();
    for (const s of skills) {
      const list = byDir.get(s.workingDir) ?? [];
      list.push(s);
      byDir.set(s.workingDir, list);
    }
    const sections: string[] = ["# Agent Team Knowledge (exported from LiquiTask)", ""];
    for (const [dir, dirSkills] of byDir) {
      sections.push(`## ${dir}`, "");
      for (const s of dirSkills.slice(0, 20)) {
        sections.push(`### ${s.title}`, s.summary, "");
      }
    }
    const blob = new Blob([sections.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "CLAUDE-agent-knowledge.md";
    a.click();
    URL.revokeObjectURL(url);
    addToast("Exported skills markdown — append to your repo CLAUDE.md", "success");
  };

  return (
    <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-red-400" />
          <h4 className="text-sm font-medium text-white">Skills library</h4>
        </div>
        <button
          type="button"
          onClick={exportToClaudeMd}
          disabled={skills.length === 0}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-40"
        >
          <Download size={12} /> Export to CLAUDE.md
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Compounded knowledge from successful agent runs. Prune stale entries or export for repo docs.
      </p>
      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
        {skills.length === 0 && (
          <p className="text-xs text-slate-600 text-center py-4">No skills yet — complete agent runs to compound knowledge.</p>
        )}
        {skills.map((skill) => (
          <div key={skill.id} className="p-3 rounded-lg bg-black/20 border border-white/5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-white font-medium truncate">{skill.title}</p>
                <p className="text-[10px] text-slate-600 truncate">{skill.workingDir}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(skill.id);
                    setEditSummary(skill.summary);
                  }}
                  className="p-1 text-slate-500 hover:text-white"
                  aria-label="Edit skill"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(skill.id)}
                  className="p-1 text-slate-500 hover:text-red-400"
                  aria-label="Delete skill"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            {editingId === skill.id ? (
              <div className="mt-2 space-y-1">
                <textarea
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={3}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveEdit(skill)}
                  className="text-[11px] text-red-400 hover:text-red-300"
                >
                  Save
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-3">{skill.summary}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
