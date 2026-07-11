import {
  AlignLeft,
  ArrowRightLeft,
  CheckSquare,
  Copy,
  Layers,
  Lock,
  MessageSquareText,
  Shield,
  User,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEstimateSuggestion } from "./useEstimateSuggestion";
import { aiService } from "../services/aiService";
import { asString, asStringArray, normalizeSubtaskTitles } from "../utils/coerce";
import { getSafeExternalUrl } from "../utils/safeUrl";
import { getBacklogColumnId } from "../utils/taskUtils";
import {
  exportQuickAddTemplates,
  extractFilePathsFromPaste,
  findDuplicateTaskTitles,
  findSimilarTaskTitles,
  formatDueDateForForm,
  formatParsedTaskSummary,
  getBatchLineStatus,
  getQuickAddCompletions,
  hasBatchBlockingErrors,
  hasQuickAddSyntax,
  importQuickAddTemplates,
  parseFormDueDate,
  parseMultipleQuickTasks,
  parseQuickAddLibrary,
  parseQuickTask,
  parsedTaskToJson,
  recordCompletionRecency,
  removeQuickAddTemplate,
  resolveParsedPriority,
  safeParseQuickTask,
  segmentQuickAddInput,
  SIMILAR_TITLE_THRESHOLD,
  suggestQuickAddMetadata,
  upsertQuickAddTemplate,
  validateQuickAddParsed,
  type ParseWarning,
  type ParsedTask,
  type QuickAddSavedTemplate,
} from "../utils/taskParser";
import { STORAGE_KEYS } from "../constants";
import { useConfirmation } from "../contexts/ConfirmationContext";
import storageService from "../services/storageService";
import { getDesktopApi } from "../runtime/runtimeEnvironment";
import type {
  AIContext,
  AITaskSchema,
  Attachment,
  BoardColumn,
  CustomFieldDefinition,
  PriorityDefinition,
  Project,
  RecurringConfig,
  Subtask,
  Task,
  TaskLink,
  ToastType,
} from "../../types";

export interface UseTaskFormParams {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (task: Partial<Task>) => void;
  onBulkCreateTasks?: (tasks: Partial<Task>[]) => void;
  initialData?: Task | null;
  projectId: string;
  priorities: PriorityDefinition[];
  customFields: CustomFieldDefinition[];
  availableTasks: Task[];
  columns: BoardColumn[];
  allProjects: Project[];
  workspacePaths: string[];
  globalWorkspacePaths: string[];
  initialAiInput: string;
  focusAiInput: boolean;
  agentNames: string[];
  aiFeaturesEnabled: boolean;
  aiSettings: {
    autoDetectDuplicates: boolean;
    autoSuggestPriorities: boolean;
    autoSuggestTags: boolean;
    cleanupOnCreate: boolean;
    similarTitleThreshold?: number;
  };
  addToast: (msg: string, type: ToastType) => void;
}

interface TaskFormSnapshot {
  formData: {
    title: string;
    subtitle: string;
    summary: string;
    assignee: string;
    priority: string;
    dueDate: string;
    status: string;
    timeEstimate: number;
  };
  subtasks: Subtask[];
  attachments: Attachment[];
  customValues: Record<string, string | number>;
  links: TaskLink[];
  recurring: RecurringConfig | undefined;
  localProjectId: string;
}

export type UseTaskFormReturn = ReturnType<typeof useTaskForm>;

export function useTaskForm({
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
}: UseTaskFormParams) {
  const { confirm } = useConfirmation();
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");
  const [formData, setFormData] = useState({
    title: "",
    subtitle: "",
    summary: "",
    assignee: "",
    priority: "",
    dueDate: "",
    status: "",
    timeEstimate: 0,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [recurring, setRecurring] = useState<RecurringConfig | undefined>(undefined);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkName, setNewLinkName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<"write" | "preview">("write");

  // Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, string | number>>({});

  // Links State
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [newLinkTarget, setNewLinkTarget] = useState<string>("");
  const [newLinkType, setNewLinkType] = useState<string>("relates-to");

  // AI State
  const [aiInput, setAiInput] = useState("");
  const [aiInputCursor, setAiInputCursor] = useState(0);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [workspaceFileCompletions, setWorkspaceFileCompletions] = useState<string[]>([]);
  const [recentQuickAdds, setRecentQuickAdds] = useState<string[]>(() =>
    storageService.get<string[]>(STORAGE_KEYS.QUICK_ADD_RECENT, []),
  );
  const [recentQuickAddsHidden, setRecentQuickAddsHidden] = useState<boolean>(() =>
    storageService.get<boolean>(STORAGE_KEYS.QUICK_ADD_RECENT_HIDDEN, false),
  );
  const [lastRefinePreset, setLastRefinePreset] = useState<string>(() =>
    storageService.get<string>(STORAGE_KEYS.QUICK_ADD_REFINE_PRESET, ""),
  );
  const [batchPreviewExpanded, setBatchPreviewExpanded] = useState(false);
  const [quickAddGuideOpen, setQuickAddGuideOpen] = useState<boolean>(() =>
    storageService.get<boolean>(STORAGE_KEYS.QUICK_ADD_GUIDE_OPEN, false),
  );
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysisSummary, setImageAnalysisSummary] = useState<string | undefined>();
  const [refinePresetChain, setRefinePresetChain] = useState<string[]>([]);
  const [quickAddUsageFlags, setQuickAddUsageFlags] = useState<Record<string, boolean>>(() =>
    storageService.get<Record<string, boolean>>(STORAGE_KEYS.QUICK_ADD_USAGE_FLAGS, {}),
  );
  const [completionRecency, setCompletionRecency] = useState<Record<string, number>>(() =>
    storageService.get<Record<string, number>>(STORAGE_KEYS.QUICK_ADD_COMPLETION_RECENCY, {}),
  );
  const [lastCreateAllBatch, setLastCreateAllBatch] = useState<string>(() =>
    storageService.get<string>(STORAGE_KEYS.QUICK_ADD_LAST_BATCH, ""),
  );
  const [createAllProgress, setCreateAllProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [savedTemplates, setSavedTemplates] = useState<QuickAddSavedTemplate[]>(() =>
    parseQuickAddLibrary(storageService.get(STORAGE_KEYS.QUICK_ADD_LIBRARY, [])),
  );
  const [quickAddHistoryIndex, setQuickAddHistoryIndex] = useState(-1);
  const quickAddHistoryDraftRef = useRef("");
  const [completionSelectedIndex, setCompletionSelectedIndex] = useState(0);
  const [fetchedGlobalPaths, setFetchedGlobalPaths] = useState<string[]>([]);
  const [quickAddUndo, setQuickAddUndo] = useState<{
    formData: typeof formData;
    attachments: Attachment[];
    localProjectId: string;
    aiInput: string;
  } | null>(null);
  const quickAddUndoTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (quickAddUndoTimerRef.current) {
        window.clearTimeout(quickAddUndoTimerRef.current);
      }
    },
    [],
  );

  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isBreakingDown, setIsBreakingDown] = useState(false);
  const [isEstimating, setIsEstimating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [localProjectId, setLocalProjectId] = useState(projectId);
  const initialSnapshotRef = useRef<TaskFormSnapshot | null>(null);
  const [extractedTasks, setExtractedTasks] = useState<AITaskSchema[] | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    title: string;
    confidence: number;
  } | null>(null);

  const estimateTask = {
    title: formData.title,
    priority: formData.priority,
    tags: initialData?.tags ?? [],
    assignee: formData.assignee,
    timeEstimate: formData.timeEstimate,
  };
  const { suggestion: learnedEstimate, hint: learnedHint } = useEstimateSuggestion(
    estimateTask,
    availableTasks,
  );
  const [autoFillSuggestions, setAutoFillSuggestions] = useState<{
    tags: string[];
    priority: string;
    assignee: string;
  } | null>(null);

  useEffect(() => {
    setLocalProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!isOpen) {
      initialSnapshotRef.current = null;
      return;
    }

    // Determine default priority ID
    const defaultPrio = priorities.length > 0 ? priorities[0].id : "";
    const defaultStatus = getBacklogColumnId(columns);

    let nextFormData = {
      title: "",
      subtitle: "General",
      summary: "",
      assignee: "",
      priority: defaultPrio,
      dueDate: "",
      status: defaultStatus,
      timeEstimate: 0,
    };
    let nextSubtasks: Subtask[] = [];
    let nextAttachments: Attachment[] = [];
    let nextCustomValues: Record<string, string | number> = {};
    let nextLinks: TaskLink[] = [];
    let nextRecurring: RecurringConfig | undefined;
    let nextLocalProjectId = projectId;

    if (initialData) {
      let dateStr = "";
      if (initialData.dueDate) {
        const d = new Date(initialData.dueDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      }

      nextFormData = {
        title: initialData.title,
        subtitle: initialData.subtitle ?? "",
        summary: initialData.summary ?? "",
        assignee: initialData.assignee ?? "",
        priority: initialData.priority || defaultPrio,
        dueDate: dateStr,
        status: initialData.status || defaultStatus,
        timeEstimate: initialData.timeEstimate || 0,
      };
      nextLocalProjectId = initialData.projectId;
      nextSubtasks = initialData.subtasks || [];
      nextAttachments = initialData.attachments || [];
      nextCustomValues = initialData.customFieldValues || {};
      nextLinks = initialData.links || [];
      nextRecurring = initialData.recurring;
    }

    setFormData(nextFormData);
    setLocalProjectId(nextLocalProjectId);
    setSubtasks(nextSubtasks);
    setAttachments(nextAttachments);
    setCustomValues(nextCustomValues);
    setLinks(nextLinks);
    setRecurring(nextRecurring);

    initialSnapshotRef.current = {
      formData: nextFormData,
      subtasks: nextSubtasks,
      attachments: nextAttachments,
      customValues: nextCustomValues,
      links: nextLinks,
      recurring: nextRecurring,
      localProjectId: nextLocalProjectId,
    };

    setErrors({});
    setActiveTab("details");
    setAiInput(initialData ? "" : initialAiInput);
    setAiInputCursor(initialData ? 0 : initialAiInput.length);
    setAiError("");
    setExtractedTasks(null);
    setBatchPreviewExpanded(false);
    setCompletionSelectedIndex(0);
    setImagePreview(null);
    setImageAnalysisSummary(undefined);
    setRefinePresetChain([]);
  }, [initialAiInput, initialData, isOpen]);

  useEffect(() => {
    if (!isOpen || initialData || !focusAiInput) return;
    const timer = window.setTimeout(() => {
      aiInputRef.current?.focus();
      const len = aiInput.length;
      aiInputRef.current?.setSelectionRange(len, len);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [aiInput.length, focusAiInput, initialData, isOpen]);

  // Subtask Handlers
  const handleAddSubtask = () => {
    if (!newSubtask.trim()) return;
    const item: Subtask = {
      id: `st-${Date.now()}`,
      title: newSubtask,
      completed: false,
    };
    setSubtasks((prev) => [...prev, item]);
    setNewSubtask("");
  };

  const handleUpdateSubtask = (id: string, title: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const toggleSubtask = (id: string) => {
    setSubtasks((prev) => prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));
  };

  // AI Handlers
  const handleSuggestTimeEstimate = async () => {
    if (!formData.title.trim()) return;
    setIsEstimating(true);
    setAiError("");
    try {
      const context: AIContext = {
        activeProjectId: localProjectId,
        projects: allProjects,
        priorities,
      };

      const taskObj: Task = {
        id: initialData?.id || "temp",
        jobId: initialData?.jobId || "",
        projectId: localProjectId,
        title: formData.title,
        subtitle: formData.subtitle || "",
        summary: formData.summary,
        assignee: formData.assignee || "",
        priority: formData.priority,
        status: formData.status,
        createdAt: new Date(),
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: formData.timeEstimate,
        timeSpent: 0,
      };

      const estimate = await aiService.suggestTimeEstimate(taskObj, context);
      if (estimate > 0) {
        setFormData((f) => ({ ...f, timeEstimate: estimate }));
        addToast(`AI suggested ${estimate} minutes`, "success");
      } else {
        addToast("AI could not estimate time for this task", "info");
      }
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setIsEstimating(false);
    }
  };

  const handleSuggestMetadata = async () => {
    if (!formData.title.trim()) return;
    setIsSuggesting(true);
    setAiError("");
    try {
      const context: AIContext = {
        activeProjectId: localProjectId,
        projects: allProjects,
        priorities,
      };
      const suggestion = await aiService.refineTaskDraft(
        "Suggest metadata like priority and tags based on the title and summary.",
        { title: formData.title, summary: formData.summary },
        context,
      );

      if (suggestion.priority) {
        const matched = priorities.find(
          (p) =>
            p.id.toLowerCase() === suggestion.priority?.toLowerCase() ||
            p.label.toLowerCase() === suggestion.priority?.toLowerCase(),
        );
        if (matched) setFormData((f) => ({ ...f, priority: matched.id }));
      }

      if (suggestion.tags && suggestion.tags.length > 0) {
        setFormData((f) => ({ ...f, subtitle: suggestion.tags?.[0] ?? "" }));
      }
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleAiRefine = async (customPrompt?: string, presetLabel?: string) => {
    const chainPrefix =
      refinePresetChain.length > 0
        ? `Already refined with: ${refinePresetChain.join(", ")}. `
        : "";
    const prompt =
      customPrompt ||
      aiInput ||
      "Refine this task draft to be clearer and more professional.";
    if (!formData.title.trim()) return;
    if (presetLabel) {
      setLastRefinePreset(presetLabel);
      storageService.set(STORAGE_KEYS.QUICK_ADD_REFINE_PRESET, presetLabel);
      markQuickAddFeatureUsed("refinePreset");
    }
    setIsGenerating(true);
    setAiError("");
    try {
      const context: AIContext = {
        activeProjectId: localProjectId,
        projects: allProjects,
        priorities,
      };
      const refined = await aiService.refineTaskDraft(
        `${chainPrefix}${prompt}`,
        {
          title: formData.title,
          subtitle: formData.subtitle,
          summary: formData.summary,
          priority: formData.priority,
          dueDate: formData.dueDate ? new Date(formData.dueDate) : undefined,
        } as Partial<Task>,
        context,
      );

      // AI output is coerced: models sometimes return title/summary/tags/
      // subtasks as objects, which otherwise render as "[object Object]" and
      // crash native agent runs (see src/utils/coerce.ts).
      const refinedTags = asStringArray(refined.tags);
      setFormData((prev) => ({
        ...prev,
        title: asString(refined.title) || prev.title,
        summary: asString(refined.summary) || prev.summary,
        priority: asString(refined.priority) || prev.priority,
        subtitle: refinedTags.length > 0 ? refinedTags[0] : prev.subtitle,
        dueDate: refined.dueDate ? refined.dueDate.split("T")[0] : prev.dueDate,
      }));

      const refinedSubtaskTitles = normalizeSubtaskTitles(refined.subtasks);
      if (refinedSubtaskTitles.length > 0) {
        const newSubtasks = refinedSubtaskTitles.map((title, i) => ({
          id: `ai-st-${Date.now()}-${i}`,
          title,
          completed: false,
        }));
        setSubtasks((prev) => [...prev, ...newSubtasks]);
      }
      if (presetLabel) {
        setRefinePresetChain((prev) => [...prev, presetLabel]);
      }
      setAiInput("");
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExtractTasks = async () => {
    if (!aiInput.trim()) return;
    if (hasQuickAddSyntax(aiInput)) {
      setAiError("Quick-add syntax detected. Use Quick Add for inline commands, or remove them for Extract Tasks.");
      return;
    }
    setIsExtracting(true);
    setAiError("");
    setExtractedTasks(null);
    try {
      const context: AIContext = {
        activeProjectId: localProjectId,
        projects: allProjects,
        priorities,
      };
      const tasks = await aiService.extractTasksFromText(aiInput, context);
      setExtractedTasks(tasks);
      markQuickAddFeatureUsed("extract");
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setIsExtracting(false);
    }
  };

  const multiQuickAddTasks = useMemo(() => {
    if (!aiInput.includes("\n")) return [];
    try {
      const parsed = parseMultipleQuickTasks(aiInput, { includeInvalid: true });
      return parsed.length > 1 ? parsed : [];
    } catch {
      return [];
    }
  }, [aiInput]);

  const batchHasBlockingErrors = useMemo(
    () => (multiQuickAddTasks.length > 1 ? hasBatchBlockingErrors(multiQuickAddTasks) : false),
    [multiQuickAddTasks],
  );

  const parsedAiInput = useMemo(() => {
    if (!aiInput.trim()) return null;
    if (aiInput.includes("\n")) {
      const lines = parseMultipleQuickTasks(aiInput);
      return lines[0] ?? safeParseQuickTask(aiInput);
    }
    return safeParseQuickTask(aiInput);
  }, [aiInput]);
  const showQuickAddPreview = Boolean(parsedAiInput && aiInput.trim());

  const quickAddSyntaxSegments = useMemo(
    () => (showQuickAddPreview ? segmentQuickAddInput(aiInput) : []),
    [aiInput, showQuickAddPreview],
  );

  const knownAssignees = useMemo(() => {
    const names = new Set<string>();
    for (const task of availableTasks) {
      if (task.assignee?.trim()) names.add(task.assignee.trim());
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [availableTasks]);

  const suggestedQuickAddMetadata = useMemo(
    () => suggestQuickAddMetadata(recentQuickAdds),
    [recentQuickAdds],
  );

  const handleSaveQuickAddTemplate = useCallback(() => {
    const content = aiInput.trim();
    if (!content) {
      addToast("Enter quick-add syntax before saving a template.", "info");
      return;
    }
    const defaultName = content.slice(0, 24).replace(/^\$/, "") || "Template";
    const name = window.prompt("Template name", defaultName)?.trim();
    if (!name) return;
    setSavedTemplates((prev) => {
      const next = upsertQuickAddTemplate(prev, name, content);
      storageService.set(STORAGE_KEYS.QUICK_ADD_LIBRARY, next);
      return next;
    });
    addToast(`Saved template "${name}".`, "success");
  }, [addToast, aiInput]);

  const handleDeleteQuickAddTemplate = useCallback(
    (id: string) => {
      setSavedTemplates((prev) => {
        const next = removeQuickAddTemplate(prev, id);
        storageService.set(STORAGE_KEYS.QUICK_ADD_LIBRARY, next);
        return next;
      });
    },
    [],
  );

  const cycleQuickAddHistory = useCallback(
    (direction: "up" | "down") => {
      if (!recentQuickAdds.length) return;
      if (direction === "up") {
        if (quickAddHistoryIndex === -1) {
          quickAddHistoryDraftRef.current = aiInput;
          const nextIndex = 0;
          setQuickAddHistoryIndex(nextIndex);
          const entry = recentQuickAdds[nextIndex];
          setAiInput(entry);
          setAiInputCursor(entry.length);
          return;
        }
        if (quickAddHistoryIndex < recentQuickAdds.length - 1) {
          const nextIndex = quickAddHistoryIndex + 1;
          setQuickAddHistoryIndex(nextIndex);
          const entry = recentQuickAdds[nextIndex];
          setAiInput(entry);
          setAiInputCursor(entry.length);
        }
        return;
      }
      if (quickAddHistoryIndex <= 0) {
        setQuickAddHistoryIndex(-1);
        const restored = quickAddHistoryDraftRef.current;
        setAiInput(restored);
        setAiInputCursor(restored.length);
        quickAddHistoryDraftRef.current = "";
        return;
      }
      const nextIndex = quickAddHistoryIndex - 1;
      setQuickAddHistoryIndex(nextIndex);
      const entry = recentQuickAdds[nextIndex];
      setAiInput(entry);
      setAiInputCursor(entry.length);
    },
    [aiInput, quickAddHistoryIndex, recentQuickAdds],
  );

  const toggleRecentQuickAddsHidden = useCallback(() => {
    setRecentQuickAddsHidden((prev) => {
      const next = !prev;
      storageService.set(STORAGE_KEYS.QUICK_ADD_RECENT_HIDDEN, next);
      return next;
    });
  }, []);

  const rememberQuickAdd = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed || !hasQuickAddSyntax(trimmed)) return;
    setQuickAddHistoryIndex(-1);
    quickAddHistoryDraftRef.current = "";
    setRecentQuickAdds((prev) => {
      const next = [trimmed, ...prev.filter((entry) => entry !== trimmed)].slice(0, 5);
      storageService.set(STORAGE_KEYS.QUICK_ADD_RECENT, next);
      return next;
    });
  }, []);

  const markQuickAddFeatureUsed = useCallback((feature: string) => {
    setQuickAddUsageFlags((prev) => {
      if (prev[feature]) return prev;
      const next = { ...prev, [feature]: true };
      storageService.set(STORAGE_KEYS.QUICK_ADD_USAGE_FLAGS, next);
      return next;
    });
  }, []);

  const toggleQuickAddGuide = useCallback(() => {
    setQuickAddGuideOpen((prev) => {
      const next = !prev;
      storageService.set(STORAGE_KEYS.QUICK_ADD_GUIDE_OPEN, next);
      return next;
    });
  }, []);

  const similarTitleThreshold =
    aiSettings.similarTitleThreshold ?? SIMILAR_TITLE_THRESHOLD;

  const quickAddUsageTip = useMemo(() => {
    if (aiInput.trim() || initialData) return null;
    const tips: Array<{ feature: string; text: string }> = [
      { feature: "createNow", text: "Tip: Press ⌘⇧↵ to create a task instantly from quick-add syntax." },
      { feature: "createAll", text: "Tip: Paste multiple lines and use Create All for batch task entry." },
      { feature: "extract", text: "Tip: Describe work in plain prose, then Extract Tasks to split it into cards." },
      { feature: "imagePaste", text: "Tip: Paste a screenshot (Ctrl+V) to extract a task from an image." },
      { feature: "refinePreset", text: "Tip: Apply a refine preset, then stack another preset on the result." },
      { feature: "tabComplete", text: "Tip: Type @, #, or > and press Tab to complete files, projects, or assignees." },
      { feature: "relativeDate", text: "Tip: Use @+3d or @next week for relative due dates." },
      { feature: "exportTemplates", text: "Tip: Export recent quick-add templates as JSON for reuse." },
    ];
    const unseen = tips.filter((tip) => !quickAddUsageFlags[tip.feature]);
    const pool = unseen.length > 0 ? unseen : tips;
    const dayIndex = Math.floor(Date.now() / 86_400_000) % pool.length;
    return pool[dayIndex]?.text ?? null;
  }, [aiInput, initialData, quickAddUsageFlags]);

  const handleExportQuickAddTemplates = useCallback(async () => {
    if (!recentQuickAdds.length) {
      addToast("No recent quick-add templates to export.", "info");
      return;
    }
    try {
      await navigator.clipboard.writeText(exportQuickAddTemplates(recentQuickAdds));
      addToast("Recent quick-add templates copied as JSON.", "success");
      markQuickAddFeatureUsed("exportTemplates");
    } catch {
      addToast("Could not copy templates to clipboard.", "warning");
    }
  }, [addToast, markQuickAddFeatureUsed, recentQuickAdds]);

  const handleImportQuickAddTemplates = useCallback(async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const imported = importQuickAddTemplates(raw);
      if (!imported.length) {
        addToast("No valid quick-add templates found in clipboard.", "warning");
        return;
      }
      setRecentQuickAdds((prev) => {
        const next = [...imported, ...prev.filter((entry) => !imported.includes(entry))].slice(0, 5);
        storageService.set(STORAGE_KEYS.QUICK_ADD_RECENT, next);
        return next;
      });
      addToast(`Imported ${imported.length} quick-add template${imported.length === 1 ? "" : "s"}.`, "success");
    } catch {
      addToast("Could not read templates from clipboard.", "warning");
    }
  }, [addToast]);

  useEffect(() => {
    if (globalWorkspacePaths.length > 0) return;
    let cancelled = false;
    getDesktopApi()
      ?.workspace.getPaths()
      .then((paths) => {
        if (!cancelled) setFetchedGlobalPaths(Array.isArray(paths) ? paths : []);
      })
      .catch(() => {
        if (!cancelled) setFetchedGlobalPaths([]);
      });
    return () => {
      cancelled = true;
    };
  }, [globalWorkspacePaths.length]);

  const effectiveWorkspacePaths = useMemo(() => {
    if (workspacePaths.length > 0) return workspacePaths;
    const projectPaths =
      allProjects.find((p) => p.id === localProjectId)?.workspacePaths ?? [];
    if (projectPaths.length > 0) return projectPaths;
    if (globalWorkspacePaths.length > 0) return globalWorkspacePaths;
    return fetchedGlobalPaths;
  }, [
    allProjects,
    fetchedGlobalPaths,
    globalWorkspacePaths,
    localProjectId,
    workspacePaths,
  ]);

  const aiAssistantMode = useMemo((): "Quick Add" | "Enhance" | "Extract" | null => {
    if (!aiInput.trim()) return null;
    if (hasQuickAddSyntax(aiInput)) return "Quick Add";
    if (initialData || formData.title.trim()) return "Enhance";
    return "Extract";
  }, [aiInput, formData.title, initialData]);

  const showWorkspacePathHint = useMemo(() => {
    if (effectiveWorkspacePaths.length > 0) return false;
    const before = aiInput.slice(0, aiInputCursor);
    const atMatch = before.match(/(?:^|\s)@([\w./\\-]*)$/);
    if (!atMatch) return false;
    const fragment = atMatch[1];
    return (
      fragment.includes(".") || fragment.includes("/") || fragment.includes("\\")
    );
  }, [aiInput, aiInputCursor, effectiveWorkspacePaths.length]);

  useEffect(() => {
    if (!showQuickAddPreview) {
      setWorkspaceFileCompletions((prev) => (prev.length ? [] : prev));
      return;
    }

    const before = aiInput.slice(0, aiInputCursor);
    const atMatch = before.match(/(?:^|\s)@([\w./\\-]*)$/);
    if (!atMatch) {
      setWorkspaceFileCompletions([]);
      return;
    }

    const fragment = atMatch[1];
    const looksLikeFile =
      fragment.includes(".") || fragment.includes("/") || fragment.includes("\\");
    if (!looksLikeFile || !fragment.trim()) {
      setWorkspaceFileCompletions([]);
      return;
    }

    const scopePaths = effectiveWorkspacePaths;

    if (scopePaths.length === 0) {
      setWorkspaceFileCompletions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const workspaceApi =
          window.desktopAPI?.workspace ?? window.electronAPI?.workspace;
        if (!workspaceApi) return;
        const results = await workspaceApi.searchFiles(fragment, scopePaths);
        if (!cancelled) {
          setWorkspaceFileCompletions(results.slice(0, 8).map((result) => result.path));
        }
      } catch {
        if (!cancelled) setWorkspaceFileCompletions([]);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    aiInput,
    aiInputCursor,
    effectiveWorkspacePaths,
    showQuickAddPreview,
  ]);

  const matchProjectByName = useCallback(
    (name: string | undefined) => {
      if (!name || !allProjects.length) return undefined;
      const needle = name.toLowerCase();
      return (
        allProjects.find((p) => p.name.toLowerCase() === needle) ??
        allProjects.find((p) => p.name.toLowerCase().startsWith(needle)) ??
        allProjects.find((p) => p.name.toLowerCase().includes(needle))
      );
    },
    [allProjects],
  );

  const quickAddCompletions = useMemo(() => {
    if (!showQuickAddPreview) return [];
    return getQuickAddCompletions(aiInput, aiInputCursor, {
      columns,
      projects: allProjects,
      workspaceFiles: workspaceFileCompletions,
      assignees: knownAssignees,
      agents: agentNames,
      completionRecency,
    });
  }, [
    agentNames,
    aiInput,
    aiInputCursor,
    allProjects,
    columns,
    knownAssignees,
    completionRecency,
    showQuickAddPreview,
    workspaceFileCompletions,
  ]);

  const quickAddWarnings = useMemo(() => {
    if (!parsedAiInput) return [];
    const warnings: ParseWarning[] = [...parsedAiInput.warnings];

    if (parsedAiInput.projectName && !matchProjectByName(parsedAiInput.projectName)) {
      warnings.push({
        code: "unknown_project",
        message: `No project matching "#${parsedAiInput.projectName}".`,
      });
    }

    if (
      parsedAiInput.priority &&
      priorities.length > 0 &&
      !priorities.some((p) => p.id === resolveParsedPriority(parsedAiInput.priority, priorities))
    ) {
      warnings.push({
        code: "unknown_priority",
        message: `Priority "${parsedAiInput.priority}" is not configured on this board.`,
      });
    }

    const duplicateTitles = findDuplicateTaskTitles(
      parsedAiInput.title,
      availableTasks.filter((t) => t.projectId === localProjectId),
    );
    if (duplicateTitles.length > 0) {
      warnings.push({
        code: "duplicate_title",
        message: `An open task already exists: "${duplicateTitles[0]}".`,
      });
    } else {
      const similarTitles = findSimilarTaskTitles(
        parsedAiInput.title,
        availableTasks.filter((t) => t.projectId === localProjectId),
        { threshold: similarTitleThreshold },
      );
      if (similarTitles.length > 0) {
        const labels = similarTitles.map((match) => `"${match.title}"`).join(", ");
        warnings.push({
          code: "similar_title",
          message: `Similar: ${labels}.`,
        });
      }
    }

    return warnings;
  }, [availableTasks, localProjectId, matchProjectByName, parsedAiInput, priorities, similarTitleThreshold]);

  const priorityPreviewStyle = useMemo(() => {
    if (!parsedAiInput?.priority) return undefined;
    const priorityId =
      resolveParsedPriority(parsedAiInput.priority, priorities) ?? parsedAiInput.priority;
    const def = priorities.find((p) => p.id === priorityId);
    if (def?.color) {
      return {
        backgroundColor: `${def.color}33`,
        color: def.color,
        borderColor: `${def.color}55`,
      } as React.CSSProperties;
    }
    const fallback: Record<string, React.CSSProperties> = {
      high: { backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444" },
      medium: { backgroundColor: "rgba(234,179,8,0.2)", color: "#eab308" },
      low: { backgroundColor: "rgba(16,185,129,0.2)", color: "#10b981" },
    };
    return fallback[priorityId] ?? fallback[parsedAiInput.priority];
  }, [parsedAiInput?.priority, priorities]);

  const getBatchPriorityStyle = useCallback(
    (priorityToken: string | undefined): React.CSSProperties | undefined => {
      if (!priorityToken) return undefined;
      const priorityId = resolveParsedPriority(priorityToken, priorities) ?? priorityToken;
      const def = priorities.find((p) => p.id === priorityId);
      if (def?.color) {
        return { backgroundColor: `${def.color}33`, color: def.color };
      }
      const fallback: Record<string, React.CSSProperties> = {
        high: { backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444" },
        medium: { backgroundColor: "rgba(234,179,8,0.2)", color: "#eab308" },
        low: { backgroundColor: "rgba(16,185,129,0.2)", color: "#10b981" },
      };
      return fallback[priorityId] ?? fallback[priorityToken];
    },
    [priorities],
  );

  const resolveQuickAddParsed = useCallback(
    (parsed: ParsedTask) => {
      let nextStatus = formData.status || getBacklogColumnId(columns);
      let nextAssignee = formData.assignee;
      if (parsed.assignee) {
        const matchedColumn = columns.find(
          (c) => c.title.toLowerCase() === parsed.assignee!.toLowerCase(),
        );
        if (matchedColumn) {
          nextStatus = matchedColumn.id;
        } else {
          nextAssignee = parsed.assignee;
        }
      }

      const matchedProject = matchProjectByName(parsed.projectName);
      const fileSummary =
        parsed.filePaths.length > 0
          ? `\n\nLinked files:\n${parsed.filePaths.map((p) => `- @${p}`).join("\n")}`
          : "";
      const descriptionSummary = parsed.description?.trim() ?? "";

      const linkedAttachments = parsed.filePaths.map((path, i) => ({
        id: `qa-file-${Date.now()}-${i}`,
        name: path.split(/[\\/]/).pop() || path,
        url: path,
        type: "link" as const,
      }));

      const urlAttachments = parsed.links.map((url, i) => ({
        id: `qa-link-${Date.now()}-${i}`,
        name: url,
        url,
        type: "link" as const,
      }));

      const parsedSubtasks = parsed.subtaskTitles.map((title, i) => ({
        id: `qa-st-${Date.now()}-${i}`,
        title,
        completed: false,
      }));

      const parsedRecurring: RecurringConfig | undefined = parsed.recurringFrequency
        ? {
            enabled: true,
            frequency: parsed.recurringFrequency,
            interval: parsed.recurringInterval ?? 1,
          }
        : undefined;

      return {
        formPatch: {
          title: parsed.title,
          priority:
            resolveParsedPriority(parsed.priority, priorities, formData.priority) ??
            formData.priority,
          dueDate: parsed.dueDate
            ? formatDueDateForForm(parsed.dueDate)
            : formData.dueDate,
          subtitle: parsed.tags[0] || formData.subtitle,
          assignee: nextAssignee,
          status: nextStatus,
          timeEstimate: parsed.timeEstimate ?? formData.timeEstimate,
          summary: [descriptionSummary, formData.summary.trim(), fileSummary.trim()]
            .filter(Boolean)
            .join("\n\n"),
        },
        projectId: matchedProject?.id,
        linkedAttachments: [...linkedAttachments, ...urlAttachments],
        tags: parsed.tags,
        subtasks: parsedSubtasks,
        recurring: parsedRecurring,
      };
    },
    [columns, formData, matchProjectByName, priorities],
  );

  const applyQuickAddCompletion = useCallback(
    (completion: { value: string }) => {
      const before = aiInput.slice(0, aiInputCursor);
      const after = aiInput.slice(aiInputCursor);
      const patterns = [
        /(?:^|\s)(@[\w./\\-]*)$/,
        /(?:^|\s)>([a-zA-Z0-9_.-]*)$/,
        /(?:^|\s)%([a-zA-Z0-9_.-]*)$/,
        /#(?:project:)?([a-zA-Z0-9_-]*)$/i,
      ];

      let tokenStart = -1;
      for (const pattern of patterns) {
        const match = before.match(pattern);
        if (match) {
          tokenStart = before.length - match[0].length + (match[0].startsWith(" ") ? 1 : 0);
          break;
        }
      }
      if (tokenStart < 0) return;

      const spacer = after.length === 0 || after.startsWith(" ") ? " " : "";
      const nextInput = `${aiInput.slice(0, tokenStart)}${completion.value}${spacer}${after}`;
      const nextCursor = tokenStart + completion.value.length + (spacer ? 1 : 0);
      setAiInput(nextInput);
      setAiInputCursor(nextCursor);
      requestAnimationFrame(() => {
        aiInputRef.current?.setSelectionRange(nextCursor, nextCursor);
        aiInputRef.current?.focus();
      });
      markQuickAddFeatureUsed("tabComplete");
      setCompletionRecency((prev) => {
        const next = recordCompletionRecency(prev, completion.value);
        storageService.set(STORAGE_KEYS.QUICK_ADD_COMPLETION_RECENCY, next);
        return next;
      });
    },
    [aiInput, aiInputCursor, markQuickAddFeatureUsed],
  );

  const insertQuickAddAtCursor = useCallback(
    (text: string) => {
      const before = aiInput.slice(0, aiInputCursor);
      const after = aiInput.slice(aiInputCursor);
      const needsSpaceBefore = before.length > 0 && !before.endsWith(" ") && !before.endsWith("\n");
      const needsSpaceAfter = after.length > 0 && !after.startsWith(" ");
      const insertion = `${needsSpaceBefore ? " " : ""}${text}${needsSpaceAfter ? " " : ""}`;
      const nextInput = `${before}${insertion}${after}`;
      const nextCursor = before.length + insertion.length;
      setAiInput(nextInput);
      setAiInputCursor(nextCursor);
      requestAnimationFrame(() => {
        aiInputRef.current?.setSelectionRange(nextCursor, nextCursor);
        aiInputRef.current?.focus();
      });
    },
    [aiInput, aiInputCursor],
  );

  const handleQuickAddPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (items) {
        let imageItem: DataTransferItem | null = null;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            imageItem = items[i];
            break;
          }
        }
        if (imageItem && aiFeaturesEnabled) {
          e.preventDefault();
          const file = imageItem.getAsFile();
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async (event) => {
            const base64 = event.target?.result as string;
            if (!base64) return;
            setImagePreview(base64);
            setIsAnalyzingImage(true);
            setAiError("");
            try {
              const result = await aiService.analyzeImageToTask(base64, {
                activeProjectId: localProjectId,
                projects: allProjects,
                priorities,
              });
              let newText = result.title || "Task from Image";
              if (result.priority) newText += ` !${result.priority}`;
              if (result.tags && result.tags.length > 0) {
                newText += result.tags.map((t) => ` +${t}`).join("");
              }
              if (result.timeEstimate) {
                newText += ` ~${result.timeEstimate}m`;
              }
              setAiInput(newText);
              setAiInputCursor(newText.length);
              setImageAnalysisSummary(asString(result.summary) || undefined);
              markQuickAddFeatureUsed("imagePaste");
            } catch (error) {
              console.error("Failed to analyze image:", error);
              setAiError("Couldn't read that image. Try again or type the task manually.");
            } finally {
              setIsAnalyzingImage(false);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      const pasted = e.clipboardData.getData("text");
      const paths = extractFilePathsFromPaste(pasted);
      if (paths.length === 0) return;
      e.preventDefault();
      insertQuickAddAtCursor(paths.map((p) => `@${p}`).join(" "));
    },
    [aiFeaturesEnabled, allProjects, insertQuickAddAtCursor, localProjectId, markQuickAddFeatureUsed, priorities],
  );

  const handleQuickAddDrop = useCallback(
    (e: React.DragEvent<HTMLTextAreaElement>) => {
      const filePaths = [...e.dataTransfer.files]
        .map((file) => {
          const withPath = file as File & { path?: string };
          return withPath.path || file.name;
        })
        .filter((path) => path.includes(".") || path.includes("/") || path.includes("\\"));
      if (filePaths.length === 0) return;
      e.preventDefault();
      insertQuickAddAtCursor(filePaths.map((p) => `@${p}`).join(" "));
    },
    [insertQuickAddAtCursor],
  );

  const scheduleQuickAddUndoClear = useCallback(() => {
    if (quickAddUndoTimerRef.current) {
      window.clearTimeout(quickAddUndoTimerRef.current);
    }
    quickAddUndoTimerRef.current = window.setTimeout(() => {
      setQuickAddUndo(null);
      quickAddUndoTimerRef.current = null;
    }, 8000);
  }, []);

  const handleUndoQuickAdd = useCallback(() => {
    if (!quickAddUndo) return;
    setFormData(quickAddUndo.formData);
    setAttachments(quickAddUndo.attachments);
    setLocalProjectId(quickAddUndo.localProjectId);
    setAiInput(quickAddUndo.aiInput);
    setAiInputCursor(quickAddUndo.aiInput.length);
    setQuickAddUndo(null);
    if (quickAddUndoTimerRef.current) {
      window.clearTimeout(quickAddUndoTimerRef.current);
      quickAddUndoTimerRef.current = null;
    }
    addToast("Quick-add changes reverted.", "info");
  }, [addToast, quickAddUndo]);

  const handleQuickAddFromInput = useCallback(() => {
    if (!aiInput.trim()) return;
    const parsed = parseQuickTask(aiInput);
    const validationError = validateQuickAddParsed(parsed);
    if (validationError) {
      setAiError(validationError);
      return;
    }

    setAiError("");
    const resolved = resolveQuickAddParsed(parsed);
    const sourceInput = aiInput;

    setQuickAddUndo({
      formData: { ...formData },
      attachments: [...attachments],
      localProjectId,
      aiInput: sourceInput,
    });
    scheduleQuickAddUndoClear();

    if (parsed.projectName && !resolved.projectId) {
      addToast(`No project matching "#${parsed.projectName}" — keeping the current project.`, "info");
    }
    if (resolved.projectId) {
      setLocalProjectId(resolved.projectId);
    }

    setFormData((prev) => ({ ...prev, ...resolved.formPatch }));

    if (resolved.linkedAttachments.length > 0) {
      setAttachments((prev) => {
        const existing = new Set(prev.map((a) => a.url));
        const linked = resolved.linkedAttachments.filter((a) => !existing.has(a.url));
        return linked.length ? [...prev, ...linked] : prev;
      });
    }

    if (resolved.subtasks.length > 0) {
      setSubtasks((prev) => [...prev, ...resolved.subtasks]);
    }

    if (resolved.recurring) {
      setRecurring(resolved.recurring);
    }

    setAiInput("");
    rememberQuickAdd(sourceInput);
    addToast("Task fields applied from quick-add syntax.", "success");
  }, [
    addToast,
    aiInput,
    attachments,
    formData,
    localProjectId,
    rememberQuickAdd,
    resolveQuickAddParsed,
    scheduleQuickAddUndoClear,
  ]);

  const buildTaskFromParsed = useCallback(
    (parsed: ParsedTask) => {
      const resolved = resolveQuickAddParsed(parsed);
      const parsedDate = resolved.formPatch.dueDate
        ? parseFormDueDate(resolved.formPatch.dueDate)
        : undefined;

      return {
        title: resolved.formPatch.title,
        subtitle: resolved.formPatch.subtitle,
        summary: resolved.formPatch.summary,
        assignee: resolved.formPatch.assignee,
        priority: resolved.formPatch.priority,
        status: resolved.formPatch.status,
        dueDate: parsedDate,
        projectId: resolved.projectId ?? localProjectId,
        timeEstimate: resolved.formPatch.timeEstimate,
        attachments: resolved.linkedAttachments,
        tags: resolved.tags,
        subtasks: resolved.subtasks.map((s) => ({ ...s })),
        recurring: resolved.recurring,
      } satisfies Partial<Task>;
    },
    [localProjectId, resolveQuickAddParsed],
  );

  const handleCreateAllFromInput = useCallback(async () => {
    if (!multiQuickAddTasks.length || initialData) return;

    if (batchHasBlockingErrors) {
      setAiError("Fix parse errors in batch lines before creating all tasks.");
      setBatchPreviewExpanded(true);
      return;
    }

    const tasks = multiQuickAddTasks
      .filter((parsed) => getBatchLineStatus(parsed).status !== "error")
      .map((parsed) => buildTaskFromParsed(parsed));
    const sourceInput = aiInput;
    const total = tasks.length;

    if (onBulkCreateTasks) {
      onBulkCreateTasks(tasks);
      rememberQuickAdd(sourceInput);
      markQuickAddFeatureUsed("createAll");
      setLastCreateAllBatch(sourceInput);
      storageService.set(STORAGE_KEYS.QUICK_ADD_LAST_BATCH, sourceInput);
      setAiInput("");
      onClose();
      addToast(`Created ${total} tasks from quick-add lines.`, "success");
      return;
    }

    setIsSubmitting(true);
    setCreateAllProgress({ current: 0, total });
    try {
      for (let index = 0; index < tasks.length; index++) {
        onSubmit(tasks[index]);
        setCreateAllProgress({ current: index + 1, total });
      }
      rememberQuickAdd(sourceInput);
      markQuickAddFeatureUsed("createAll");
      setLastCreateAllBatch(sourceInput);
      storageService.set(STORAGE_KEYS.QUICK_ADD_LAST_BATCH, sourceInput);
      setAiInput("");
      onClose();
      addToast(`Created ${total} tasks from quick-add lines.`, "success");
    } finally {
      setCreateAllProgress(null);
      setIsSubmitting(false);
    }
  }, [
    addToast,
    aiInput,
    batchHasBlockingErrors,
    buildTaskFromParsed,
    initialData,
    markQuickAddFeatureUsed,
    multiQuickAddTasks,
    onBulkCreateTasks,
    onClose,
    onSubmit,
    rememberQuickAdd,
  ]);

  const handleCopyParsedPreview = useCallback(async () => {
    if (!parsedAiInput) return;
    const text = `${formatParsedTaskSummary(parsedAiInput)}\n\n${parsedTaskToJson(parsedAiInput)}`;
    try {
      await navigator.clipboard.writeText(text);
      addToast("Parsed preview copied to clipboard.", "success");
    } catch {
      addToast("Could not copy parsed preview.", "warning");
    }
  }, [addToast, parsedAiInput]);

  const handleCreateExtractedTasks = () => {
    if (!extractedTasks) return;
    const newTasks = extractedTasks.map((et) => {
      let parsedDate: Date | undefined;
      if (et.dueDate) {
        // Parse a date-only value as LOCAL midnight (matching the manual form
        // path) so AI-extracted due dates land on the correct calendar day
        // regardless of timezone.
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(et.dueDate);
        parsedDate = dateOnly
          ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
          : new Date(et.dueDate);
      }

      const etTags = asStringArray(et.tags);
      return {
        title: asString(et.title),
        summary: asString(et.summary),
        priority: asString(et.priority),
        subtitle: etTags.length > 0 ? etTags[0] : "General",
        dueDate: parsedDate,
        projectId: localProjectId,
        status: getBacklogColumnId(columns),
        subtasks: normalizeSubtaskTitles(et.subtasks).map((title, i) => ({
          id: `st-${Date.now()}-${i}`,
          title,
          completed: false,
        })),
        tags: etTags,
        timeEstimate: et.timeEstimate || 0,
      };
    });

    if (onBulkCreateTasks) {
      onBulkCreateTasks(newTasks);
    } else {
      newTasks.forEach((t) => {
        onSubmit(t);
      });
    }
    onClose();
  };

  const handleAiBreakdown = async () => {
    if (!formData.title.trim()) return;
    setIsBreakingDown(true);
    try {
      const suggested = await aiService.generateSubtasks(formData.title, formData.summary);
      const newItems = suggested.map((title, i) => ({
        id: `ai-st-${Date.now()}-${i}`,
        title,
        completed: false,
      }));
      setSubtasks([...subtasks, ...newItems]);
    } catch (e) {
      console.error("AI Breakdown error:", e);
    } finally {
      setIsBreakingDown(false);
    }
  };

  const handleSmartAutofill = () => {
    const projectTasks = availableTasks.filter(
      (t) => t.projectId === localProjectId && t.completedAt,
    );
    if (projectTasks.length < 2) return;

    const tagCounts: Record<string, number> = {};
    const priorityCounts: Record<string, number> = {};
    const assigneeCounts: Record<string, number> = {};

    projectTasks.forEach((t) => {
      t.tags.forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
      if (t.priority) priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      if (t.assignee) assigneeCounts[t.assignee] = (assigneeCounts[t.assignee] || 0) + 1;
    });

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);
    const topPriority = Object.entries(priorityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const topAssignee = Object.entries(assigneeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    setAutoFillSuggestions({
      tags: topTags,
      priority: topPriority,
      assignee: topAssignee,
    });
  };

  const applyAutoFill = () => {
    if (!autoFillSuggestions) return;
    if (autoFillSuggestions.tags.length > 0) {
      setFormData((f) => ({ ...f, subtitle: autoFillSuggestions.tags[0] }));
    }
    if (autoFillSuggestions.priority) {
      setFormData((f) => ({ ...f, priority: autoFillSuggestions.priority }));
    }
    if (autoFillSuggestions.assignee) {
      setFormData((f) => ({ ...f, assignee: autoFillSuggestions.assignee }));
    }
    setAutoFillSuggestions(null);
  };

  // Attachment Handlers
  const handleAddLink = () => {
    const safeUrl = getSafeExternalUrl(newLinkUrl);
    if (!safeUrl) return;

    const item: Attachment = {
      id: `att-${Date.now()}`,
      name: newLinkName.trim() || safeUrl,
      url: safeUrl,
      type: "link",
    };
    setAttachments([...attachments, item]);
    setNewLinkUrl("");
    setNewLinkName("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      const item: Attachment = {
        id: `att-${Date.now()}`,
        name: file.name,
        url: objectUrl,
        type: "file",
      };
      setAttachments([...attachments, item]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveAttachment = (id: string) => {
    const att = attachments.find((a) => a.id === id);
    if (att?.type === "file") {
      URL.revokeObjectURL(att.url);
    }
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  // Keep a ref to the latest attachments so the unmount cleanup revokes the
  // blob URLs that actually exist at unmount time (a [] dependency would capture
  // the initial, empty list and leak any blobs added during the session).
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  // Revoke all file-type blob URLs when the modal unmounts to prevent memory leaks
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((att) => {
        if (att.type === "file") {
          URL.revokeObjectURL(att.url);
        }
      });
    };
  }, []);

  // Task Link Handlers
  const handleAddTaskLink = () => {
    if (!newLinkTarget) return;
    if (links.some((l) => l.targetTaskId === newLinkTarget)) return;

    const newLink: TaskLink = {
      targetTaskId: newLinkTarget,
      type: newLinkType as TaskLink["type"],
    };
    setLinks([...links, newLink]);
    setNewLinkTarget("");
  };

  const handleRemoveTaskLink = (targetId: string) => {
    setLinks(links.filter((l) => l.targetTaskId !== targetId));
  };

  const defaultStatusId = getBacklogColumnId(columns);

  const submitTask = useCallback(async (overrides?: {
    formData?: Partial<typeof formData>;
    localProjectId?: string;
    attachments?: Attachment[];
    subtasks?: Subtask[];
    recurring?: RecurringConfig;
    skipAiProcessing?: boolean;
    focusFieldOnError?: "title" | "ai";
  }) => {
    const effectiveForm = { ...formData, ...overrides?.formData };
    const effectiveProjectId = overrides?.localProjectId ?? localProjectId;
    const effectiveAttachments = overrides?.attachments ?? attachments;
    const effectiveSubtasks = overrides?.subtasks ?? subtasks;
    const effectiveRecurring = overrides?.recurring ?? recurring;

    // Validation
    const newErrors: Record<string, string> = {};
    if (!effectiveForm.title.trim()) {
      newErrors.title = "Task title is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      requestAnimationFrame(() => {
        if (overrides?.focusFieldOnError === "ai") {
          aiInputRef.current?.focus();
        } else {
          titleInputRef.current?.focus();
        }
      });
      return false;
    }

    setIsSubmitting(true);
    try {
    let parsedDate: Date | undefined;
    if (effectiveForm.dueDate) {
      parsedDate = parseFormDueDate(effectiveForm.dueDate);
    }

    const taskData: Partial<Task> = {
      ...initialData,
      ...effectiveForm,
      projectId: effectiveProjectId,
      status: effectiveForm.status || defaultStatusId,
      createdAt: initialData ? initialData.createdAt : new Date(),
      dueDate: parsedDate,
      subtasks: effectiveSubtasks,
      attachments: effectiveAttachments,
      customFieldValues: customValues,
      links: links,
      timeEstimate: effectiveForm.timeEstimate,
      recurring: effectiveRecurring,
    };

    const buildPreviewTask = (draft: Partial<Task>): Task => ({
      id: draft.id ?? initialData?.id ?? `preview-${Date.now()}`,
      jobId: draft.jobId ?? initialData?.jobId ?? "PREVIEW",
      projectId: draft.projectId ?? effectiveProjectId,
      title: draft.title ?? "",
      subtitle: draft.subtitle ?? "",
      summary: draft.summary ?? "",
      assignee: draft.assignee ?? "",
      priority: draft.priority ?? priorities[0]?.id ?? "medium",
      status: draft.status ?? defaultStatusId,
      createdAt: draft.createdAt ?? initialData?.createdAt ?? new Date(),
      updatedAt: draft.updatedAt,
      dueDate: draft.dueDate,
      subtasks: draft.subtasks ?? [],
      attachments: draft.attachments ?? [],
      customFieldValues: draft.customFieldValues ?? {},
      links: draft.links ?? [],
      tags: draft.tags ?? [],
      timeEstimate: draft.timeEstimate ?? 0,
      timeSpent: draft.timeSpent ?? 0,
      recurring: draft.recurring,
      completedAt: draft.completedAt,
      errorLogs: draft.errorLogs,
      activity: draft.activity,
      order: draft.order,
    });

    // AI Processing
    const isNewTask = !initialData;

    if (isNewTask && !overrides?.skipAiProcessing && aiFeaturesEnabled) {
      // Auto-suggest priority
      if (aiSettings.autoSuggestPriorities) {
        try {
          const context: AIContext = {
            activeProjectId: effectiveProjectId,
            projects: allProjects,
            priorities: priorities,
          };
          const suggestions = await aiService.suggestPriorities(
            [buildPreviewTask(taskData)],
            context,
          );
          if (suggestions.length > 0 && suggestions[0].confidence > 0.6) {
            const suggestedPriorityId = suggestions[0].suggestedValue as string;
            const priorityDef = priorities.find((p) => p.id === suggestedPriorityId);
            if (priorityDef) {
              taskData.priority = suggestedPriorityId;
              addToast(`AI suggested priority: ${priorityDef.label}`, "info");
            }
          }
        } catch (e) {
          console.warn("AI priority suggestion failed:", e);
        }
      }

      // Auto-suggest tags
      if (aiSettings.autoSuggestTags) {
        try {
          const context: AIContext = {
            activeProjectId: effectiveProjectId,
            projects: allProjects,
            priorities: priorities,
          };
          const metadata = await aiService.suggestMetadata(
            effectiveForm.title,
            effectiveForm.summary || "",
            context,
          );
          if (metadata.tags && metadata.tags.length > 0) {
            taskData.tags = [...(taskData.tags || []), ...metadata.tags];
            addToast(`AI suggested tags: ${metadata.tags.join(", ")}`, "info");
          }
        } catch (e) {
          console.warn("AI tag suggestion failed:", e);
        }
      }

      // Auto-detect duplicates (show warning, don't block)
      if (aiSettings.autoDetectDuplicates && availableTasks.length > 0) {
        try {
          const context: AIContext = {
            activeProjectId: effectiveProjectId,
            projects: allProjects,
            priorities: priorities,
          };
          const pairs = availableTasks.slice(0, 10).map((t) => ({
            task1: buildPreviewTask(taskData),
            task2: t,
          }));
          const duplicates = await aiService.detectDuplicates(pairs, context);

          if (duplicates.length > 0 && duplicates[0].confidence > 0.7) {
            setDuplicateWarning({
              title: duplicates[0].task2.title,
              confidence: duplicates[0].confidence,
            });
          }
        } catch (e) {
          console.warn("AI duplicate detection failed:", e);
        }
      }

      // Cleanup on create (check for redundancy)
      if (aiSettings.cleanupOnCreate) {
        try {
          const context: AIContext = {
            activeProjectId: effectiveProjectId,
            projects: allProjects,
            priorities: priorities,
          };
          const redundancy = await aiService.analyzeRedundancy(
            [...availableTasks, buildPreviewTask(taskData)],
            context,
          );
          if (redundancy && redundancy.confidence > 0.7) {
            addToast(`Potential redundancy detected: ${redundancy.reasoning}`, "info");
          }
        } catch (e) {
          console.warn("AI redundancy check failed:", e);
        }
      }
    }

    onSubmit(taskData);
    onClose();
    return true;
    } finally {
      setIsSubmitting(false);
    }
  }, [
    formData,
    initialData,
    localProjectId,
    subtasks,
    attachments,
    customValues,
    links,
    onSubmit,
    onClose,
    aiFeaturesEnabled,
    aiSettings,
    priorities,
    defaultStatusId,
    allProjects,
    availableTasks,
    addToast,
    recurring,
  ]);

  const handleCreateNowFromInput = useCallback(async () => {
    if (!aiInput.trim() || initialData) return;
    const parsed = parseQuickTask(aiInput);
    const validationError = validateQuickAddParsed(parsed);
    if (validationError) {
      setAiError(validationError);
      aiInputRef.current?.focus();
      return;
    }

    setAiError("");
    const resolved = resolveQuickAddParsed(parsed);
    const sourceInput = aiInput;

    if (parsed.projectName && !resolved.projectId) {
      addToast(`No project matching "#${parsed.projectName}" — using the current project.`, "info");
    }

    const existing = new Set(attachments.map((a) => a.url));
    const linked = resolved.linkedAttachments.filter((a) => !existing.has(a.url));
    const mergedAttachments = linked.length ? [...attachments, ...linked] : attachments;

    const created = await submitTask({
      formData: resolved.formPatch,
      localProjectId: resolved.projectId,
      attachments: mergedAttachments,
      subtasks: resolved.subtasks,
      recurring: resolved.recurring,
      skipAiProcessing: true,
      focusFieldOnError: "ai",
    });

    if (created) {
      rememberQuickAdd(sourceInput);
      markQuickAddFeatureUsed("createNow");
      setAiInput("");
    }
  }, [
    addToast,
    aiInput,
    attachments,
    initialData,
    markQuickAddFeatureUsed,
    rememberQuickAdd,
    resolveQuickAddParsed,
    submitTask,
  ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTask();
  };

  const isDirty = useMemo(() => {
    const baseline = initialSnapshotRef.current;
    if (!baseline || !isOpen) return false;
    const current: TaskFormSnapshot = {
      formData,
      subtasks,
      attachments,
      customValues,
      links,
      recurring,
      localProjectId,
    };
    return JSON.stringify(current) !== JSON.stringify(baseline);
  }, [
    formData,
    subtasks,
    attachments,
    customValues,
    links,
    recurring,
    localProjectId,
    isOpen,
  ]);

  const requestClose = useCallback(async () => {
    if (!isDirty) {
      onClose();
      return;
    }
    const confirmed = await confirm({
      title: "Discard Unsaved Changes?",
      message: "You have unsaved changes in this task form. Discard them and close?",
      confirmText: "Discard",
      variant: "warning",
    });
    if (confirmed) onClose();
  }, [confirm, isDirty, onClose]);

  // Auto-grow AI quick-add textarea (capped for long batches).
  useEffect(() => {
    const el = aiInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [aiInput]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        submitTask();
      }
      if (!initialData && (e.key === "/" || ((e.ctrlKey || e.metaKey) && e.key === "k"))) {
        const target = e.target as HTMLElement | null;
        const isOtherInput =
          target &&
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
          target !== aiInputRef.current;
        if (!isOtherInput) {
          e.preventDefault();
          aiInputRef.current?.focus();
          const len = aiInput.length;
          aiInputRef.current?.setSelectionRange(len, len);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aiInput.length, initialData, isOpen, submitTask]);

  const getLinkIcon = (type: string) => {
    switch (type) {
      case "blocked-by":
        return <Lock size={12} />;
      case "blocks":
        return <Shield size={12} />;
      case "duplicates":
        return <Copy size={12} />;
      default:
        return <ArrowRightLeft size={12} />;
    }
  };

  const quickPrompts = useMemo(() => {
    const prompts = [
      {
        label: "Summarize",
        icon: <AlignLeft size={10} />,
        prompt: "Summarize this task clearly.",
      },
      {
        label: "Technical",
        icon: <Layers size={10} />,
        prompt: "Refine this into a technical task with implementation steps.",
      },
      {
        label: "Formal",
        icon: <User size={10} />,
        prompt: "Rewrite this description in a formal, professional tone.",
      },
      {
        label: "Bullet Points",
        icon: <AlignLeft size={10} />,
        prompt: "Rewrite the description as concise bullet points.",
      },
      {
        label: "Concise",
        icon: <MessageSquareText size={10} />,
        prompt: "Make the title and description shorter while keeping key details.",
      },
      {
        label: "Action Items",
        icon: <CheckSquare size={10} />,
        prompt: "Extract clear action items and acceptance criteria from this task.",
      },
    ];
    if (!lastRefinePreset) return prompts;
    const lastIndex = prompts.findIndex((entry) => entry.label === lastRefinePreset);
    if (lastIndex <= 0) return prompts;
    const reordered = [...prompts];
    const [lastUsed] = reordered.splice(lastIndex, 1);
    reordered.unshift(lastUsed);
    return reordered;
  }, [lastRefinePreset]);

  useEffect(() => {
    setCompletionSelectedIndex(0);
  }, [quickAddCompletions]);

  return {
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
    aiInput,
    setAiInput,
    aiInputCursor,
    setAiInputCursor,
    aiInputRef,
    titleInputRef,
    recentQuickAdds,
    recentQuickAddsHidden,
    lastRefinePreset,
    batchPreviewExpanded,
    setBatchPreviewExpanded,
    quickAddGuideOpen,
    toggleQuickAddGuide,
    imagePreview,
    setImagePreview,
    isAnalyzingImage,
    imageAnalysisSummary,
    setImageAnalysisSummary,
    refinePresetChain,
    setRefinePresetChain,
    savedTemplates,
    handleSaveQuickAddTemplate,
    handleDeleteQuickAddTemplate,
    quickAddHistoryIndex,
    setQuickAddHistoryIndex,
    quickAddHistoryDraftRef,
    completionSelectedIndex,
    setCompletionSelectedIndex,
    quickAddUndo,
    handleUndoQuickAdd,
    lastCreateAllBatch,
    createAllProgress,
    isGenerating,
    setIsGenerating,
    isSuggesting,
    isEstimating,
    isExtracting,
    aiError,
    setAiError,
    localProjectId,
    setLocalProjectId,
    extractedTasks,
    duplicateWarning,
    setDuplicateWarning,
    learnedEstimate,
    learnedHint,
    autoFillSuggestions,
    multiQuickAddTasks,
    batchHasBlockingErrors,
    parsedAiInput,
    showQuickAddPreview,
    quickAddSyntaxSegments,
    suggestedQuickAddMetadata,
    quickAddCompletions,
    quickAddWarnings,
    priorityPreviewStyle,
    getBatchPriorityStyle,
    matchProjectByName,
    aiAssistantMode,
    showWorkspacePathHint,
    quickAddUsageTip,
    quickPrompts,
    handleSuggestTimeEstimate,
    handleSuggestMetadata,
    handleAiRefine,
    handleExtractTasks,
    cycleQuickAddHistory,
    toggleRecentQuickAddsHidden,
    handleExportQuickAddTemplates,
    handleImportQuickAddTemplates,
    applyQuickAddCompletion,
    handleQuickAddPaste,
    handleQuickAddDrop,
    handleQuickAddFromInput,
    handleCreateAllFromInput,
    handleCopyParsedPreview,
    handleCreateExtractedTasks,
    handleSmartAutofill,
    applyAutoFill,
    handleCreateNowFromInput,
    handleSubmit,
    isDirty,
    requestClose,
  };
}
