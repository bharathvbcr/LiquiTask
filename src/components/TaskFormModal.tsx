import {
  AlertTriangle,
  AlignLeft,
  Calendar,
  Clock,
  Edit2,
  Eye,
  Flag,
  History,
  Kanban,
  Layers,
  Loader2,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import type React from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import { Input } from "./common/Input";
import { LiquidDatePicker } from "./common/LiquidDatePicker";
import { aiService } from "../services/aiService";
import {
  SIMILAR_TITLE_THRESHOLD,
} from "../utils/taskParser";
import type {
  AIContext,
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  Task,
  ToastType,
} from "../../types";
import { ModalWrapper } from "./ModalWrapper";
import { TimeTracker } from "./TimeTracker";
import { Tooltip } from "./Tooltip";
import { TaskEvidencePanel } from "./agents/TaskEvidencePanel";
import { useTaskForm } from "../hooks/useTaskForm";
import { ActivityTimeline } from "./task-form/ActivityTimeline";
import { AiAssistPanel } from "./task-form/AiAssistPanel";
import { AttachmentsSection } from "./task-form/AttachmentsSection";
import { CustomFieldsSection } from "./task-form/CustomFieldsSection";
import { LinksSection } from "./task-form/LinksSection";
import { RecurrenceField } from "./task-form/RecurrenceField";
import { SubtasksSection } from "./task-form/SubtasksSection";

const EMPTY_PRIORITIES: PriorityDefinition[] = [];
const EMPTY_CUSTOM_FIELDS: CustomFieldDefinition[] = [];
const EMPTY_TASKS: Task[] = [];
const EMPTY_COLUMNS: BoardColumn[] = [];
const EMPTY_WORKSPACE_PATHS: string[] = [];

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (task: Partial<Task>) => void;
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
  initialData?: Task | null;
  projectId: string;
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
  availableTasks?: Task[]; // For linking
  columns?: BoardColumn[]; // For status selection
  allProjects?: Project[]; // Added for AI project suggestion
  workspacePaths?: string[];
  globalWorkspacePaths?: string[];
  /** Prefill the AI / quick-add field when opening in create mode. */
  initialAiInput?: string;
  /** Focus the AI / quick-add field when the modal opens in create mode. */
  focusAiInput?: boolean;
  /** Agent teammate names for %agent tab completion. */
  agentNames?: string[];
  aiFeaturesEnabled?: boolean;
  aiSettings?: {
    autoDetectDuplicates: boolean;
    autoSuggestPriorities: boolean;
    autoSuggestTags: boolean;
    cleanupOnCreate: boolean;
    similarTitleThreshold?: number;
  };
  addToast?: (msg: string, type: ToastType) => void;
  /** Persist timeSpent immediately while editing (auto-save / Save on TimeTracker). */
  onUpdateTimeSpent?: (taskId: string, timeSpent: number) => void;
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onBulkCreateTasks,
  initialData,
  projectId,
  priorities = EMPTY_PRIORITIES,
  customFields = EMPTY_CUSTOM_FIELDS,
  availableTasks = EMPTY_TASKS,
  columns = EMPTY_COLUMNS,
  allProjects = [],
  workspacePaths = EMPTY_WORKSPACE_PATHS,
  globalWorkspacePaths = EMPTY_WORKSPACE_PATHS,
  initialAiInput = "",
  focusAiInput = false,
  agentNames = [],
  aiFeaturesEnabled = true,
  aiSettings = {
    autoDetectDuplicates: false,
    autoSuggestPriorities: false,
    autoSuggestTags: false,
    cleanupOnCreate: false,
    similarTitleThreshold: SIMILAR_TITLE_THRESHOLD,
  },
  addToast = () => {},
  onUpdateTimeSpent,
}) => {
  const form = useTaskForm({
    isOpen,
    onClose,
    onSubmit,
    onBulkCreateTasks,
    initialData,
    projectId,
    priorities,
    customFields,
    availableTasks,
    columns,
    allProjects,
    workspacePaths,
    globalWorkspacePaths,
    initialAiInput,
    focusAiInput,
    agentNames,
    aiFeaturesEnabled,
    aiSettings,
    addToast,
  });

  const {
    activeTab,
    setActiveTab,
    formData,
    setFormData,
    errors,
    setErrors,
    isSubmitting,
    subtasks,
    newSubtask,
    setNewSubtask,
    handleAddSubtask,
    handleUpdateSubtask,
    handleRemoveSubtask,
    toggleSubtask,
    handleAiBreakdown,
    isBreakingDown,
    recurring,
    setRecurring,
    attachments,
    newLinkUrl,
    setNewLinkUrl,
    newLinkName,
    setNewLinkName,
    fileInputRef,
    handleAddLink,
    handleFileUpload,
    handleRemoveAttachment,
    viewMode,
    setViewMode,
    customValues,
    setCustomValues,
    links,
    newLinkTarget,
    setNewLinkTarget,
    newLinkType,
    setNewLinkType,
    handleAddTaskLink,
    handleRemoveTaskLink,
    getLinkIcon,
    titleInputRef,
    isGenerating,
    setIsGenerating,
    isSuggesting,
    isEstimating,
    setAiError,
    localProjectId,
    setLocalProjectId,
    duplicateWarning,
    setDuplicateWarning,
    learnedEstimate,
    learnedHint,
    handleSuggestTimeEstimate,
    handleSuggestMetadata,
    handleSubmit,
    requestClose,
  } = form;

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={requestClose}
      title={initialData ? "Edit Task" : "New Task"}
      icon={<Layers size={20} />}
      size="2xl"
      footer={
        activeTab === "details" ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => void requestClose()}
              className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="task-form"
              disabled={isSubmitting}
              className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-glow-red transition-all duration-300 transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  {initialData ? "Updating…" : "Creating…"}
                </span>
              ) : initialData ? (
                "Update Task"
              ) : (
                "Create Task"
              )}
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="flex gap-4 mb-6 border-b border-white/10">
        <button
          onClick={() => setActiveTab("details")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === "details" ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
        >
          <Edit2 size={14} /> Details
        </button>
        <button
          onClick={() => setActiveTab("activity")}
          className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === "activity" ? "border-red-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}
        >
          <History size={14} /> Activity
        </button>
      </div>

      {activeTab === "details" && (
        <div className="flex flex-col gap-6">
          {/* AI Quick Add */}
          {aiFeaturesEnabled && (
          <AiAssistPanel
            form={form}
            initialData={initialData}
            aiFeaturesEnabled={aiFeaturesEnabled}
            priorities={priorities}
            allProjects={allProjects}
            availableTasks={availableTasks}
          />
          )}

          <form id="task-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* Title */}
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Task Title
                </label>
                {aiFeaturesEnabled && (
                <button
                  type="button"
                  onClick={handleSuggestMetadata}
                  disabled={isSuggesting || !formData.title.trim()}
                  className="text-[10px] font-bold text-red-300 hover:text-red-200 flex items-center gap-1 transition-colors px-2 py-1 rounded bg-red-500/10 border border-red-500/20"
                >
                  {isSuggesting ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Sparkles size={10} />
                  )}
                  Suggest Metadata
                </button>
                )}
              </div>
              <Input
                ref={titleInputRef}
                name="title"
                required
                autoFocus
                value={formData.title}
                onChange={(e) => {
                  const newTitle = e.target.value;
                  setFormData({ ...formData, title: newTitle });
                  if (errors.title) setErrors({ ...errors, title: "" });
                  if (newTitle.trim().length > 3 && !initialData) {
                    const normalize = (t: string) =>
                      t
                        .toLowerCase()
                        .replace(/[^\w\s]/g, "")
                        .trim();
                    const n1 = normalize(newTitle);
                    const similar = availableTasks.find((t) => {
                      const n2 = normalize(t.title);
                      if (n1 === n2) return true;
                      if (n1.includes(n2) || n2.includes(n1)) return true;
                      const w1 = new Set(n1.split(/\s+/));
                      const w2 = new Set(n2.split(/\s+/));
                      const inter = new Set([...w1].filter((w) => w2.has(w)));
                      const union = new Set([...w1, ...w2]);
                      return union.size > 0 && inter.size / union.size > 0.6;
                    });
                    if (similar) {
                      setDuplicateWarning({
                        title: similar.title,
                        confidence: 0.8,
                      });
                    } else {
                      setDuplicateWarning(null);
                    }
                  } else {
                    setDuplicateWarning(null);
                  }
                }}
                placeholder="e.g., Update Q3 Financials"
                className="font-medium text-lg"
                error={errors.title}
              />
              {aiFeaturesEnabled && duplicateWarning && (
                <div className="mt-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-amber-300">
                      Possible duplicate detected
                    </p>
                    <p className="text-[10px] text-amber-400/80 mt-0.5">
                      Similar to: "{duplicateWarning.title}"
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-6">
              {/* Project Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Layers size={12} /> Project
                </label>
                <div className="relative">
                  <Tooltip content="Select task project" position="top">
                    <select
                      value={localProjectId}
                      onChange={(e) => setLocalProjectId(e.target.value)}
                      className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                      aria-label="Task project"
                    >
                      {allProjects.map((p) => (
                        <option key={p.id} value={p.id} className="bg-navy-900 text-slate-200">
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Tooltip>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg
                      width="10"
                      height="6"
                      viewBox="0 0 10 6"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1 1L5 5L9 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Flag size={12} /> Priority
                </label>
                <div className="relative">
                  <Tooltip content="Select task priority" position="top">
                    <select
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none cursor-pointer"
                      aria-label="Task priority"
                    >
                      {priorities.map((p) => (
                        <option key={p.id} value={p.id} className="bg-navy-900 text-slate-200">
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </Tooltip>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg
                      width="10"
                      height="6"
                      viewBox="0 0 10 6"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1 1L5 5L9 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Status Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Kanban size={12} /> Status
                </label>
                <div className="relative">
                  <Tooltip content="Select task status" position="top">
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none cursor-pointer"
                      aria-label="Task status"
                    >
                      {columns.map((col) => (
                        <option key={col.id} value={col.id} className="bg-navy-900 text-slate-200">
                          {col.title}
                        </option>
                      ))}
                    </select>
                  </Tooltip>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg
                      width="10"
                      height="6"
                      viewBox="0 0 10 6"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1 1L5 5L9 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="task-category" className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Tag size={12} /> Category
                </label>
                <input
                  id="task-category"
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                  placeholder="e.g., Marketing"
                  className="w-full liquid-input rounded-xl px-4 py-3 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="task-assignee" className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <User size={12} /> Assignee
                </label>
                <input
                  id="task-assignee"
                  type="text"
                  value={formData.assignee}
                  onChange={(e) => setFormData({ ...formData, assignee: e.target.value })}
                  placeholder="e.g., Sarah Smith"
                  className="w-full liquid-input rounded-xl px-4 py-3 text-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <Calendar size={12} /> Due Date
                </label>
                <LiquidDatePicker
                  value={formData.dueDate}
                  onChange={(dueDate) => setFormData({ ...formData, dueDate })}
                  aria-label="Task due date"
                />
              </div>

              <RecurrenceField recurring={recurring} setRecurring={setRecurring} />

              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                    <Clock size={12} /> Est. Time (mins)
                  </label>
                  <div className="flex items-center gap-2">
                    {learnedEstimate && (
                      <button
                        type="button"
                        onClick={() =>
                          setFormData((f) => ({ ...f, timeEstimate: learnedEstimate.minutes }))
                        }
                        className="text-[10px] font-medium text-sky-300/90 hover:text-sky-200 px-2 py-1 rounded bg-sky-500/10 border border-sky-500/20"
                        title={learnedHint ?? undefined}
                      >
                        ~{learnedEstimate.minutes}m from runs
                      </button>
                    )}
                    {aiFeaturesEnabled && (
                    <Tooltip content="AI Estimate based on title and description" position="top">
                      <button
                        type="button"
                        onClick={handleSuggestTimeEstimate}
                        disabled={isEstimating || !formData.title.trim()}
                        className="text-[10px] font-bold text-red-300 hover:text-red-200 flex items-center gap-1 transition-colors px-2 py-1 rounded bg-red-500/10 border border-red-500/20"
                      >
                        {isEstimating ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Sparkles size={10} />
                        )}
                        AI Estimate
                      </button>
                    </Tooltip>
                    )}
                  </div>
                </div>
                {learnedHint && (
                  <p className="text-[10px] text-slate-500 pl-1 mb-1">{learnedHint}</p>
                )}
                <Tooltip content="Task time estimate in minutes" position="top">
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={formData.timeEstimate || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, timeEstimate: parseInt(e.target.value, 10) || 0 })
                    }
                    placeholder="e.g., 60"
                    className="w-full liquid-input rounded-xl px-4 py-3 text-sm"
                    aria-label="Task time estimate in minutes"
                  />
                </Tooltip>
              </div>

              {initialData && !String(initialData.id).startsWith("temp-") && (
                <TimeTracker
                  task={{
                    ...initialData,
                    title: formData.title,
                    subtitle: formData.subtitle,
                    summary: formData.summary,
                    assignee: formData.assignee,
                    priority: formData.priority,
                    status: formData.status,
                    timeSpent: formData.timeSpent ?? initialData.timeSpent ?? 0,
                    timeEstimate: formData.timeEstimate ?? initialData.timeEstimate ?? 0,
                  }}
                  onSaveTime={(taskId, timeSpent) => {
                    setFormData((prev) => ({ ...prev, timeSpent }));
                    onUpdateTimeSpent?.(taskId, timeSpent);
                  }}
                />
              )}
            </div>

            {/* Custom Fields Section */}
            <CustomFieldsSection
              customFields={customFields}
              customValues={customValues}
              setCustomValues={setCustomValues}
            />

            {/* Description */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                  <AlignLeft size={12} /> Description
                </label>
                <div className="flex items-center gap-2">
                  <Tooltip content="Polish description with AI" position="top">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!formData.summary.trim()) return;
                        setIsGenerating(true);
                        try {
                          const context: AIContext = {
                            activeProjectId: localProjectId,
                            projects: allProjects,
                            priorities,
                          };
                          const refined = await aiService.refineTaskDraft(
                            "Polish this task description to be professional and clear. Maintain markdown formatting.",
                            { title: formData.title, summary: formData.summary },
                            context,
                          );
                          if (refined.summary)
                            setFormData((f) => ({
                              ...f,
                              summary: refined.summary ?? "",
                            }));
                        } catch (e) {
                          setAiError((e as Error).message);
                        } finally {
                          setIsGenerating(false);
                        }
                      }}
                      disabled={isGenerating || !formData.summary.trim()}
                      className="text-[10px] font-bold text-red-300 hover:text-red-200 flex items-center gap-1 transition-colors px-2 py-1 rounded bg-red-500/10 border border-red-500/20"
                    >
                      {isGenerating ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        <Sparkles size={10} />
                      )}
                      Polish
                    </button>
                  </Tooltip>
                  <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
                    <button
                      type="button"
                      onClick={() => setViewMode("write")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${viewMode === "write" ? "bg-red-500/20 text-red-300 shadow-sm" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      <Edit2 size={10} /> Write
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${viewMode === "preview" ? "bg-red-500/20 text-red-300 shadow-sm" : "text-slate-500 hover:text-slate-300"}`}
                    >
                      <Eye size={10} /> Preview
                    </button>
                  </div>
                </div>
              </div>
              {viewMode === "write" ? (
                <textarea
                  required
                  value={formData.summary}
                  onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                  placeholder="Describe the task details. Supports Markdown (e.g., **bold**, - list)..."
                  className="w-full h-32 liquid-input rounded-xl px-4 py-3 text-sm resize-none font-mono"
                />
              ) : (
                <div className="w-full h-32 liquid-input rounded-xl px-4 py-3 text-sm overflow-y-auto markdown-content bg-black/20">
                  {formData.summary ? (
                    <MarkdownRenderer content={formData.summary} />
                  ) : (
                    <span className="text-slate-600 italic">No description to preview.</span>
                  )}
                </div>
              )}
            </div>

            {/* Links & Dependencies */}
            <LinksSection
              links={links}
              availableTasks={availableTasks}
              initialData={initialData}
              newLinkType={newLinkType}
              setNewLinkType={setNewLinkType}
              newLinkTarget={newLinkTarget}
              setNewLinkTarget={setNewLinkTarget}
              handleAddTaskLink={handleAddTaskLink}
              handleRemoveTaskLink={handleRemoveTaskLink}
              getLinkIcon={getLinkIcon}
            />

            {/* DevCouncil provenance — self-hides for non-DevCouncil-planned tasks. */}
            {initialData && <TaskEvidencePanel task={initialData} />}

            {/* Subtasks */}
            <SubtasksSection
              subtasks={subtasks}
              newSubtask={newSubtask}
              setNewSubtask={setNewSubtask}
              handleAddSubtask={handleAddSubtask}
              handleUpdateSubtask={handleUpdateSubtask}
              handleRemoveSubtask={handleRemoveSubtask}
              toggleSubtask={toggleSubtask}
              handleAiBreakdown={handleAiBreakdown}
              isBreakingDown={isBreakingDown}
              aiFeaturesEnabled={aiFeaturesEnabled}
              canBreakdown={Boolean(formData.title.trim())}
            />

            {/* Attachments */}
            <AttachmentsSection
              attachments={attachments}
              newLinkName={newLinkName}
              setNewLinkName={setNewLinkName}
              newLinkUrl={newLinkUrl}
              setNewLinkUrl={setNewLinkUrl}
              handleAddLink={handleAddLink}
              handleFileUpload={handleFileUpload}
              handleRemoveAttachment={handleRemoveAttachment}
              fileInputRef={fileInputRef}
            />
          </form>
        </div>
      )}

      {activeTab === "activity" && <ActivityTimeline activity={initialData?.activity} />}
    </ModalWrapper>
  );
};
