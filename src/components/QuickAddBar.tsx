import { Calendar, Flag, Image as ImageIcon, Loader2, Plus, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { PriorityDefinition, Project } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";
import { parseQuickTask } from "../utils/taskParser";
import { Button } from "./common/Button";

interface QuickAddBarProps {
  onAddTask: (
    title: string,
    options?: {
      priority?: string;
      dueDate?: Date;
      projectId?: string;
      timeEstimate?: number;
      tags?: string[];
      summary?: string;
    },
  ) => void;
  isVisible: boolean;
  onClose: () => void;
  projects?: Array<{ id: string; name: string }>;
}

export const QuickAddBar: React.FC<QuickAddBarProps> = ({ onAddTask, isVisible, onClose }) => {
  const [input, setInput] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    } else if (!isVisible) {
      // Reset state on close
      setInput("");
      setImagePreview(null);
      setAiSummary(undefined);
    }
  }, [isVisible]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isVisible) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, onClose]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let imageItem: DataTransferItem | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        imageItem = items[i];
        break;
      }
    }

    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        if (base64) {
          setImagePreview(base64);
          setIsAnalyzing(true);
          try {
            const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
            const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
            const priorities = storageService.get<PriorityDefinition[]>(
              STORAGE_KEYS.PRIORITIES,
              [],
            );

            const result = await aiService.analyzeImageToTask(base64, {
              activeProjectId,
              projects,
              priorities,
            });

            // Construct new input based on AI findings
            let newText = result.title || "Task from Image";
            if (result.priority) newText += ` !${result.priority}`;
            if (result.tags && result.tags.length > 0) {
              newText += result.tags.map((t) => ` +${t}`).join("");
            }
            if (result.timeEstimate) {
              newText += ` ~${result.timeEstimate}m`;
            }

            setInput(newText);
            setAiSummary(result.summary);
          } catch (error) {
            console.error("Failed to analyze image:", error);
          } finally {
            setIsAnalyzing(false);
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || (!input.trim() && !imagePreview)) return;
    isSubmittingRef.current = true;
    try {
      const parsed = parseQuickTask(input || "Task from Image");
      if (parsed.title) {
        onAddTask(parsed.title, {
          priority: parsed.priority,
          dueDate: parsed.dueDate,
          timeEstimate: parsed.timeEstimate,
          tags: parsed.tags,
          summary: aiSummary,
        });
        setInput("");
        setImagePreview(null);
        setAiSummary(undefined);
        onClose();
      }
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const parsed = parseQuickTask(input);

  if (!isVisible) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Quick Add Modal */}
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 animate-in zoom-in-95 fade-in duration-150">
        <form onSubmit={handleSubmit} className="relative">
          <div className="liquid-surface overflow-hidden flex flex-col liquid-topline">
            {/* Image Preview Area */}
            {imagePreview && (
              <div className="relative w-full h-32 bg-black/50 border-b border-white/10 overflow-hidden flex items-center justify-center">
                <img src={imagePreview} alt="Task snippet" className="max-h-full object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    setImagePreview(null);
                    setAiSummary(undefined);
                  }}
                  className="absolute top-2 right-2 p-1 bg-black/50 hover:bg-red-500/80 rounded-full text-white transition-colors"
                >
                  <X size={14} />
                </button>
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                    <Loader2 size={24} className="text-cyan-400 animate-spin" />
                    <span className="text-xs font-medium text-white shadow-black drop-shadow-md">
                      AI analyzing image...
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Input */}
            <div className="flex items-center gap-3 p-4">
              <Plus size={20} className="text-red-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={input}
                onPaste={handlePaste}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Add task or paste an image... (e.g., 'Review PR !high @tomorrow')"
                className="flex-1 bg-transparent text-lg text-white placeholder-slate-500 outline-none"
              />
              <Button
                type="button"
                onClick={onClose}
                variant="ghost"
                className="!p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg h-auto"
              >
                <X size={18} />
              </Button>
            </div>

            {/* Preview & Hints */}
            <div className="px-4 pb-4 border-t border-white/5">
              {/* Parsed preview */}
              {(input || imagePreview) && (
                <div className="flex items-center gap-3 py-3 border-b border-white/5">
                  <span className="text-sm text-slate-300">{parsed.title || "Task name..."}</span>
                  {parsed.priority && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                        parsed.priority === "high"
                          ? "bg-red-500/20 text-red-400"
                          : parsed.priority === "medium"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-emerald-500/20 text-emerald-400"
                      }`}
                    >
                      <Flag size={10} className="inline mr-1" />
                      {parsed.priority}
                    </span>
                  )}
                  {parsed.dueDate && (
                    <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                      <Calendar size={10} className="inline mr-1" />
                      {parsed.dueDate.toLocaleDateString()}
                    </span>
                  )}
                  {parsed.timeEstimate && (
                    <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-400">
                      ~{parsed.timeEstimate}m
                    </span>
                  )}
                  {parsed.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded text-xs bg-slate-500/20 text-slate-400"
                    >
                      #{tag}
                    </span>
                  ))}
                  {aiSummary && (
                    <span
                      className="px-2 py-0.5 rounded text-xs bg-cyan-500/20 text-cyan-400 truncate max-w-[150px]"
                      title={aiSummary}
                    >
                      <ImageIcon size={10} className="inline mr-1" />
                      Image context added
                    </span>
                  )}
                </div>
              )}

              {/* Hints */}
              <div className="pt-3 flex flex-wrap gap-2 items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  <Hint label="!h" description="High priority" />
                  <Hint label="!m" description="Medium" />
                  <Hint label="!l" description="Low" />
                  <Hint label="@today" description="Due today" />
                  <Hint label="@tom" description="Tomorrow" />
                  <Hint label="@fri" description="Weekday" />
                  <Hint label="@1/15" description="MM/DD" />
                  <Hint label="#project" description="Project" />
                  <Hint label="+tag" description="Add tag" />
                  <Hint label="~2h" description="Estimate" />
                </div>
                <div className="text-[10px] text-cyan-500/80 flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-white/5 rounded">Ctrl</kbd>+
                  <kbd className="px-1 py-0.5 bg-white/5 rounded">V</kbd> to paste image
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
};

const Hint: React.FC<{ label: string; description: string }> = ({ label, description }) => (
  <div className="flex items-center gap-1.5 text-[10px] hover-lift">
    <kbd className="px-2 py-0.5 liquid-glass rounded-lg text-white/80 font-mono text-[10px] border border-white/10">{label}</kbd>
    <span className="text-slate-500">{description}</span>
  </div>
);

export default QuickAddBar;
