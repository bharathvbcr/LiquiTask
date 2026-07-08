import {
  Image as ImageIcon,
  AlertTriangle,
  AlignLeft,
  ArrowRightLeft,
  Calendar,
  Check,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  Clock,
  Copy,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  Flag,
  HelpCircle,
  History,
  Kanban,
  Layers,
  Link,
  Link as LinkIcon,
  Loader2,
  Lock,
  MessageSquareText,
  Paperclip,
  Plus,
  Repeat,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  User,
  Wand2,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "./common/Input";
import { LiquidDatePicker } from "./common/LiquidDatePicker";
import { useEstimateSuggestion } from "../hooks/useEstimateSuggestion";
import { aiService } from "../services/aiService";
import { asString, asStringArray, normalizeSubtaskTitles } from "../utils/coerce";
import { getSafeExternalUrl } from "../utils/safeUrl";
import { getBacklogColumnId } from "../utils/taskUtils";
import {
  exportQuickAddTemplates,
  extractFilePathsFromPaste,
  findDuplicateTaskTitles,
  findSimilarTaskTitles,
  formatParsedTaskSummary,
  getBatchLineStatus,
  getQuickAddCompletions,
  hasBatchBlockingErrors,
  hasQuickAddSyntax,
  importQuickAddTemplates,
  parseMultipleQuickTasks,
  parseQuickTask,
  parsedTaskToJson,
  resolveParsedPriority,
  safeParseQuickTask,
  segmentQuickAddInput,
  SIMILAR_TITLE_THRESHOLD,
  suggestQuickAddMetadata,
  type ParseWarning,
  type ParsedTask,
  type QuickAddTokenKind,
} from "../utils/taskParser";
import { STORAGE_KEYS } from "../constants";
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
import { ModalWrapper } from "./ModalWrapper";
import { Tooltip } from "./Tooltip";
import { TaskEvidencePanel } from "./agents/TaskEvidencePanel";

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
  aiSettings?: {
    autoDetectDuplicates: boolean;
    autoSuggestPriorities: boolean;
    autoSuggestTags: boolean;
    cleanupOnCreate: boolean;
    similarTitleThreshold?: number;
  };
  addToast?: (msg: string, type: ToastType) => void;
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
  aiSettings = {
    autoDetectDuplicates: false,
    autoSuggestPriorities: false,
    autoSuggestTags: false,
    cleanupOnCreate: false,
    similarTitleThreshold: SIMILAR_TITLE_THRESHOLD,
  },
  addToast = () => {},
}) => {
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
  const [createAllProgress, setCreateAllProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
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
    // Determine default priority ID
    const defaultPrio = priorities.length > 0 ? priorities[0].id : "";
    const defaultStatus = getBacklogColumnId(columns);

    if (initialData) {
      let dateStr = "";
      if (initialData.dueDate) {
        const d = new Date(initialData.dueDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        dateStr = `${year}-${month}-${day}`;
      }

      setFormData({
        title: initialData.title,
        subtitle: initialData.subtitle ?? "",
        summary: initialData.summary ?? "",
        assignee: initialData.assignee ?? "",
        priority: initialData.priority || defaultPrio,
        dueDate: dateStr,
        status: initialData.status || defaultStatus,
        timeEstimate: initialData.timeEstimate || 0,
      });
      setLocalProjectId(initialData.projectId);
      setSubtasks(initialData.subtasks || []);
      setAttachments(initialData.attachments || []);
      setCustomValues(initialData.customFieldValues || {});
      setLinks(initialData.links || []);
      setRecurring(initialData.recurring);
    } else {
      setFormData({
        title: "",
        subtitle: "General",
        summary: "",
        assignee: "",
        priority: defaultPrio,
        dueDate: "",
        status: defaultStatus,
        timeEstimate: 0,
      });
      setSubtasks([]);
      setAttachments([]);
      setCustomValues({});
      setLinks([]);
      setRecurring(undefined);
    }
    setErrors({});
    if (isOpen) {
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
    }
  }, [initialAiInput, initialData, isOpen, priorities, columns]);

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
    setSubtasks([...subtasks, item]);
    setNewSubtask("");
  };

  const handleUpdateSubtask = (id: string, title: string) => {
    setSubtasks(subtasks.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(subtasks.filter((s) => s.id !== id));
  };

  const toggleSubtask = (id: string) => {
    setSubtasks(subtasks.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));
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
  const showQuickAddPreview = Boolean(
    parsedAiInput &&
      (multiQuickAddTasks.length > 1 || hasQuickAddSyntax(aiInput)),
  );

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
    });
  }, [
    aiInput,
    aiInputCursor,
    allProjects,
    columns,
    knownAssignees,
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

      const linkedAttachments = parsed.filePaths.map((path, i) => ({
        id: `qa-file-${Date.now()}-${i}`,
        name: path.split(/[\\/]/).pop() || path,
        url: path,
        type: "link" as const,
      }));

      return {
        formPatch: {
          title: parsed.title,
          priority:
            resolveParsedPriority(parsed.priority, priorities, formData.priority) ??
            formData.priority,
          dueDate: parsed.dueDate
            ? parsed.dueDate.toISOString().split("T")[0]
            : formData.dueDate,
          subtitle: parsed.tags[0] || formData.subtitle,
          assignee: nextAssignee,
          status: nextStatus,
          timeEstimate: parsed.timeEstimate ?? formData.timeEstimate,
          summary: [formData.summary.trim(), fileSummary.trim()].filter(Boolean).join("\n"),
        },
        projectId: matchedProject?.id,
        linkedAttachments,
        tags: parsed.tags,
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
        /#([a-zA-Z0-9_-]*)$/,
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
        if (imageItem) {
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
    [allProjects, insertQuickAddAtCursor, localProjectId, markQuickAddFeatureUsed, priorities],
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
    if (!parsed.title.trim()) {
      setAiError("Enter a task title ($Title, plain text, or fill the title field).");
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
      let parsedDate: Date | undefined;
      if (resolved.formPatch.dueDate) {
        const [y, m, d] = resolved.formPatch.dueDate.split("-").map(Number);
        parsedDate = new Date(y, m - 1, d);
      }

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
    skipAiProcessing?: boolean;
    focusFieldOnError?: "title" | "ai";
  }) => {
    const effectiveForm = { ...formData, ...overrides?.formData };
    const effectiveProjectId = overrides?.localProjectId ?? localProjectId;
    const effectiveAttachments = overrides?.attachments ?? attachments;

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
      const [y, m, d] = effectiveForm.dueDate.split("-").map(Number);
      parsedDate = new Date(y, m - 1, d);
    }

    const taskData: Partial<Task> = {
      ...initialData,
      ...effectiveForm,
      projectId: effectiveProjectId,
      status: effectiveForm.status || defaultStatusId,
      createdAt: initialData ? initialData.createdAt : new Date(),
      dueDate: parsedDate,
      subtasks: subtasks,
      attachments: effectiveAttachments,
      customFieldValues: customValues,
      links: links,
      timeEstimate: effectiveForm.timeEstimate,
      recurring,
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

    if (isNewTask && !overrides?.skipAiProcessing) {
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
    if (!parsed.title.trim()) {
      setAiError("Enter a task title ($Title, plain text, or fill the title field).");
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

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={initialData ? "Edit Task" : "New Task"}
      icon={<Layers size={20} />}
      size="2xl"
      footer={
        activeTab === "details" ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
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
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
            <label htmlFor="ai-input" className="flex items-center gap-2 text-sm font-bold text-red-300">
              <Sparkles size={16} /> AI Assistant
              {aiAssistantMode && (
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 transition-all duration-300 ease-out animate-in fade-in slide-in-from-left-1">
                  {aiAssistantMode}
                </span>
              )}
              <button
                type="button"
                onClick={toggleQuickAddGuide}
                className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                aria-expanded={quickAddGuideOpen}
                aria-controls="quick-add-guide"
              >
                {quickAddGuideOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <HelpCircle size={12} />
                Quick Add Guide
              </button>
            </label>

            {quickAddGuideOpen && (
              <div
                id="quick-add-guide"
                className="liquid-surface border border-white/10 rounded-xl p-3 space-y-2 text-[11px] text-slate-400"
              >
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                  Syntax Examples
                </p>
                <div className="grid gap-1.5 font-mono text-slate-300">
                  <p>
                    <span className="text-red-300">$Fix login bug</span> !h @src/auth.ts +urgent @tom #work &gt;agent ~2h
                  </p>
                  <p>
                    <span className="text-red-300">$Title</span> — explicit title; <span className="text-slate-500">!1–!5</span> priority by level
                  </p>
                  <p>
                    Tab completes @files, #projects, &gt;assignees; Ctrl+Enter fills form; Ctrl+Shift+Enter creates now; Esc clears input
                  </p>
                  <p>
                    Relative dates: <span className="text-slate-500">@+3d</span>, <span className="text-slate-500">@+1w</span>, <span className="text-slate-500">@next week</span>; paste images with Ctrl+V
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 relative">
              {imagePreview && (
                <div className="relative w-full h-28 bg-black/40 border border-white/10 rounded-lg overflow-hidden flex items-center justify-center">
                  <img src={imagePreview} alt="Pasted task snippet" className="max-h-full object-contain" />
                  <button
                    type="button"
                    onClick={() => {
                      setImagePreview(null);
                      setImageAnalysisSummary(undefined);
                    }}
                    aria-label="Remove image preview"
                    className="absolute top-2 right-2 p-1 bg-black/50 hover:bg-red-500/80 rounded-full text-white transition-colors"
                  >
                    <X size={14} />
                  </button>
                  {isAnalyzingImage && (
                    <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                      <Loader2 size={20} className="text-red-400 animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white">
                        Analyzing Image
                      </span>
                    </div>
                  )}
                  {imageAnalysisSummary && !isAnalyzingImage && (
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[9px] bg-red-500/20 text-red-300 flex items-center gap-1">
                      <ImageIcon size={10} />
                      Image context added
                    </span>
                  )}
                </div>
              )}

              {showQuickAddPreview && quickAddSyntaxSegments.length > 0 && (
                <div
                  aria-hidden="true"
                  className="px-4 py-2 rounded-lg bg-black/20 border border-white/5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
                >
                  {quickAddSyntaxSegments.map((segment, index) => (
                    <span key={`${segment.kind}-${index}-${segment.text}`} className={quickAddTokenClass(segment.kind)}>
                      {segment.text}
                    </span>
                  ))}
                </div>
              )}

              <textarea
                ref={aiInputRef}
                id="ai-input"
                value={aiInput}
                role="combobox"
                aria-expanded={quickAddCompletions.length > 0}
                aria-controls={quickAddCompletions.length > 0 ? "quick-add-completions" : undefined}
                aria-autocomplete="list"
                aria-label="AI assistant and quick-add input"
                onChange={(e) => {
                  setAiInput(e.target.value);
                  setAiInputCursor(e.target.selectionStart ?? 0);
                }}
                onSelect={(e) =>
                  setAiInputCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
                }
                onClick={(e) =>
                  setAiInputCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
                }
                onPaste={handleQuickAddPaste}
                onDrop={handleQuickAddDrop}
                onDragOver={(e) => {
                  if ([...e.dataTransfer.types].includes("Files")) {
                    e.preventDefault();
                  }
                }}
                onKeyDown={(e) => {
                  if (quickAddCompletions.length > 0) {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      applyQuickAddCompletion(quickAddCompletions[completionSelectedIndex]);
                      return;
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setCompletionSelectedIndex((prev) =>
                        Math.min(prev + 1, Math.min(quickAddCompletions.length, 6) - 1),
                      );
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setCompletionSelectedIndex((prev) => Math.max(prev - 1, 0));
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setCompletionSelectedIndex(0);
                      return;
                    }
                  }
                  if (e.key === "Escape" && aiInput.trim()) {
                    e.preventDefault();
                    e.stopPropagation();
                    setAiInput("");
                    setAiInputCursor(0);
                    setImagePreview(null);
                    setImageAnalysisSummary(undefined);
                    setRefinePresetChain([]);
                    return;
                  }
                  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter" && showQuickAddPreview && !initialData) {
                    e.preventDefault();
                    void handleCreateNowFromInput();
                    return;
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && showQuickAddPreview) {
                    e.preventDefault();
                    handleQuickAddFromInput();
                  }
                }}
                placeholder={
                  initialData
                    ? "Refine with AI, or quick-add: $\"Title Here\" !h @file.ts +tag @tom"
                    : suggestedQuickAddMetadata
                      ? `Quick-add: $Title ${suggestedQuickAddMetadata} — or describe tasks for AI extract`
                      : "Quick-add: $Title !h @src/file.ts +tag @tom >agent — or describe tasks for AI extract"
                }
                className="w-full liquid-input border border-red-500/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50 min-h-[80px] resize-none font-mono"
              />

              {!recentQuickAddsHidden && recentQuickAdds.length > 0 && (
                <div
                  className={`flex flex-wrap items-center gap-2 px-1 transition-all ${
                    aiInput.trim() ? "opacity-60 max-h-7 overflow-hidden" : ""
                  }`}
                >
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold shrink-0">
                    Recent
                  </span>
                  {recentQuickAdds.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => {
                        setAiInput(entry);
                        setAiInputCursor(entry.length);
                        requestAnimationFrame(() => {
                          aiInputRef.current?.focus();
                          aiInputRef.current?.setSelectionRange(entry.length, entry.length);
                        });
                      }}
                      className={`truncate rounded-lg bg-white/5 border border-white/10 font-mono text-slate-300 hover:bg-white/10 hover:text-white transition-colors ${
                        aiInput.trim()
                          ? "max-w-[120px] px-1.5 py-0.5 text-[9px]"
                          : "max-w-[220px] px-2 py-1 text-[10px]"
                      }`}
                      title={entry}
                    >
                      {entry}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleExportQuickAddTemplates()}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                      title="Copy recent templates as JSON"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleImportQuickAddTemplates()}
                      className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                      title="Import templates from clipboard"
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={toggleRecentQuickAddsHidden}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                      aria-label="Hide recent quick-add templates"
                    >
                      <EyeOff size={10} />
                      Hide
                    </button>
                  </div>
                </div>
              )}

              {recentQuickAddsHidden && recentQuickAdds.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <button
                    type="button"
                    onClick={toggleRecentQuickAddsHidden}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                  >
                    <Eye size={10} />
                    Show Recent
                  </button>
                </div>
              )}

              {!recentQuickAddsHidden && !aiInput.trim() && suggestedQuickAddMetadata && (
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold shrink-0">
                    Suggested
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = `$Title ${suggestedQuickAddMetadata}`;
                      setAiInput(next);
                      setAiInputCursor(6);
                      requestAnimationFrame(() => {
                        aiInputRef.current?.focus();
                        aiInputRef.current?.setSelectionRange(1, 6);
                      });
                    }}
                    className="truncate max-w-[260px] px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 font-mono text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors text-[10px]"
                    title={`Insert suggested metadata: ${suggestedQuickAddMetadata}`}
                  >
                    $Title {suggestedQuickAddMetadata}
                  </button>
                </div>
              )}

              {showWorkspacePathHint && (
                <p className="text-[11px] text-slate-500 px-1 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  Link a workspace folder in project settings to enable @file search.
                </p>
              )}

              {quickAddUsageTip && (
                <p className="text-[11px] text-slate-500 px-1">{quickAddUsageTip}</p>
              )}

              {refinePresetChain.length > 0 && (
                <p className="text-[11px] text-red-300/80 px-1">
                  Refined with {refinePresetChain.join(" → ")}. Apply another preset to stack refinements.
                </p>
              )}

              {quickAddUndo && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] text-slate-400">Fields applied.</span>
                  <button
                    type="button"
                    onClick={handleUndoQuickAdd}
                    className="text-[10px] font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
                  >
                    Undo
                  </button>
                </div>
              )}

              {quickAddCompletions.length > 0 && (
                <div
                  id="quick-add-completions"
                  role="listbox"
                  aria-label="Quick-add completions"
                  aria-activedescendant={`quick-add-completion-${completionSelectedIndex}`}
                  className="absolute left-0 right-0 top-full z-10 mt-1 liquid-surface border border-white/10 rounded-xl overflow-hidden shadow-lg"
                >
                  <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold border-b border-white/5">
                    Tab Or Arrows To Complete
                  </div>
                  {quickAddCompletions.slice(0, 6).map((completion, index) => (
                    <button
                      key={`${completion.kind}-${completion.value}`}
                      id={`quick-add-completion-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === completionSelectedIndex}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setCompletionSelectedIndex(index)}
                      onClick={() => applyQuickAddCompletion(completion)}
                      className={`w-full px-3 py-2.5 min-h-[44px] text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                        index === completionSelectedIndex
                          ? "bg-white/10 text-white"
                          : "text-slate-300 hover:bg-white/5 active:bg-white/10"
                      }`}
                    >
                      <span className="font-mono text-white/90">{completion.value}</span>
                      <span className="text-slate-500 capitalize">
                        {completion.kind === "column" ? "Column" : completion.kind}
                        {completion.label !== completion.value.replace(/^[@>#]/, "") &&
                          `: ${completion.label}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {multiQuickAddTasks.length > 1 && (
                <div className="px-1 border border-white/10 rounded-lg bg-white/5 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setBatchPreviewExpanded((prev) => !prev)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    {batchPreviewExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Batch Preview ({multiQuickAddTasks.length} Tasks)
                  </button>
                  {batchPreviewExpanded && (
                    <ul className="border-t border-white/5 divide-y divide-white/5 max-h-40 overflow-y-auto">
                      {multiQuickAddTasks.map((parsed, index) => {
                        const lineStatus = getBatchLineStatus(parsed);
                        return (
                        <li
                          key={`${parsed.title}-${index}`}
                          className="px-3 py-2 text-xs text-slate-300 flex items-center gap-2"
                        >
                          <span className="text-slate-500 font-mono shrink-0">{index + 1}.</span>
                          <span
                            className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${
                              lineStatus.status === "error"
                                ? "text-red-400"
                                : lineStatus.status === "warning"
                                  ? "text-amber-400"
                                  : "text-emerald-400"
                            }`}
                          >
                            {lineStatus.status}
                          </span>
                          <span className="truncate">{parsed.title || "(no title)"}</span>
                          {lineStatus.message && lineStatus.status !== "ok" && (
                            <span className="ml-auto shrink-0 text-[9px] text-slate-500 truncate max-w-[140px]" title={lineStatus.message}>
                              {lineStatus.message}
                            </span>
                          )}
                          {parsed.priority && (
                            <span
                              className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase border border-transparent"
                              style={getBatchPriorityStyle(parsed.priority)}
                            >
                              {resolveParsedPriority(parsed.priority, priorities) ?? parsed.priority}
                            </span>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {showQuickAddPreview && parsedAiInput && (
                <div className="flex flex-wrap items-center gap-2 px-1 py-2 border-b border-white/5">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                    Preview
                  </span>
                  <span className="text-xs text-slate-300">{parsedAiInput.title || "Task name…"}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopyParsedPreview()}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                    aria-label="Copy parsed preview"
                  >
                    <Copy size={10} />
                    Copy
                  </button>
                  {parsedAiInput.priority && (
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-transparent"
                      style={priorityPreviewStyle}
                    >
                      {resolveParsedPriority(parsedAiInput.priority, priorities) ??
                        parsedAiInput.priority}
                    </span>
                  )}
                  {parsedAiInput.dueDate && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
                      {parsedAiInput.dueDate.toLocaleDateString()}
                    </span>
                  )}
                  {parsedAiInput.timeEstimate && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
                      ~{parsedAiInput.timeEstimate}m
                    </span>
                  )}
                  {parsedAiInput.projectName && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] ${
                        matchProjectByName(parsedAiInput.projectName)
                          ? "bg-white/10 text-slate-300"
                          : "bg-white/10 text-slate-500 line-through"
                      }`}
                    >
                      #{matchProjectByName(parsedAiInput.projectName)?.name ?? parsedAiInput.projectName}
                    </span>
                  )}
                  {parsedAiInput.filePaths.map((path) => (
                    <span
                      key={path}
                      className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300 font-mono"
                    >
                      @{path}
                    </span>
                  ))}
                  {parsedAiInput.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-400"
                    >
                      +{tag}
                    </span>
                  ))}
                  {parsedAiInput.assignee && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-slate-300">
                      &gt;{parsedAiInput.assignee}
                    </span>
                  )}
                </div>
              )}

              {showQuickAddPreview && quickAddWarnings.length > 0 && (
                <div className="space-y-1 px-1">
                  {quickAddWarnings.map((warning) => (
                    <p
                      key={`${warning.code}-${warning.message}`}
                      className="text-[11px] text-amber-400/90 flex items-start gap-1.5"
                    >
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      {warning.message}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-1">
                {quickPrompts.map((qp) => (
                  <button
                    key={qp.label}
                    type="button"
                    onClick={() => handleAiRefine(qp.prompt, qp.label)}
                    disabled={isGenerating || !formData.title.trim()}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold transition-all ${
                      qp.label === lastRefinePreset
                        ? "bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25"
                        : "bg-white/5 border-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {qp.icon} {qp.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                {showQuickAddPreview && (
                  <button
                    type="button"
                    onClick={handleQuickAddFromInput}
                    disabled={!parsedAiInput?.title.trim()}
                    className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white border border-white/10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    <Plus size={16} />
                    {initialData ? "Apply" : "Fill Form"}
                  </button>
                )}
                {showQuickAddPreview && !initialData && (
                  <button
                    type="button"
                    onClick={() => void handleCreateNowFromInput()}
                    disabled={!parsedAiInput?.title.trim() || isSubmitting}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed text-slate-950 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSubmitting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Check size={16} />
                    )}
                    Create Now
                  </button>
                )}
                {multiQuickAddTasks.length > 1 && !initialData && (
                  <button
                    type="button"
                    onClick={() => void handleCreateAllFromInput()}
                    disabled={isSubmitting || batchHasBlockingErrors}
                    title={batchHasBlockingErrors ? "Fix parse errors in batch lines first" : undefined}
                    className="flex-1 px-4 py-2 bg-red-600/80 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed text-slate-950 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {createAllProgress
                          ? `Creating ${createAllProgress.current}/${createAllProgress.total}…`
                          : "Creating…"}
                      </>
                    ) : (
                      <>
                        <Layers size={16} />
                        Create All ({multiQuickAddTasks.length})
                      </>
                    )}
                  </button>
                )}
                {!initialData && (
                  <button
                    type="button"
                    onClick={handleExtractTasks}
                    disabled={isExtracting || !aiInput.trim() || showQuickAddPreview}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 disabled:cursor-not-allowed text-slate-950 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isExtracting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FileText size={16} />
                    )}
                    Extract Tasks
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleAiRefine()}
                  disabled={
                    isGenerating ||
                    showQuickAddPreview ||
                    (!initialData && !aiInput.trim()) ||
                    !formData.title.trim()
                  }
                  className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white border border-white/10 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  {isGenerating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Wand2 size={16} />
                  )}
                  Refine Draft
                </button>
              </div>

              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 items-center justify-between">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <QuickAddHint label="$title" description="Title" />
                  <QuickAddHint label="!h" description="High" />
                  <QuickAddHint label="!1" description="Level" />
                  <QuickAddHint label="!m" description="Medium" />
                  <QuickAddHint label="@file.ts" description="File" />
                  <QuickAddHint label="@tom" description="Due" />
                  <QuickAddHint label="@+3d" description="Relative" />
                  <QuickAddHint label="#project" description="Project" />
                  <QuickAddHint label="+tag" description="Tag" />
                  <QuickAddHint label=">agent" description="Assign" />
                  <QuickAddHint label="~2h" description="Estimate" />
                </div>
                {showQuickAddPreview && (
                  <div className="text-[10px] text-slate-500 flex items-center gap-2">
                    <span>
                      <kbd className="px-1 py-0.5 liquid-glass rounded border border-white/10">⌘↵</kbd> Fill
                    </span>
                    {!initialData && (
                      <span>
                        <kbd className="px-1 py-0.5 liquid-glass rounded border border-white/10">⌘⇧↵</kbd> Create
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            {aiError && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1.5">
                <X size={12} /> {aiError}
              </p>
            )}

            {/* Smart Autofill */}
            {!initialData && availableTasks.length > 1 && (
              <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-red-400" />
                    <span className="text-xs font-bold text-slate-300">Smart Autofill</span>
                    <span className="text-[10px] text-slate-500">Based on project history</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSmartAutofill}
                    disabled={!!autoFillSuggestions}
                    className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 disabled:opacity-50 text-red-400 rounded-md text-[10px] font-bold transition-colors"
                  >
                    {autoFillSuggestions ? "Suggestions Ready" : "Analyze"}
                  </button>
                </div>
                {autoFillSuggestions && (
                  <div className="mt-2 space-y-1.5 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <Tag size={10} /> Suggested tags:{" "}
                      {autoFillSuggestions.tags.join(", ") || "None"}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <Flag size={10} /> Suggested priority:{" "}
                      {autoFillSuggestions.priority || "None"}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <User size={10} /> Suggested assignee:{" "}
                      {autoFillSuggestions.assignee || "None"}
                    </div>
                    <button
                      type="button"
                      onClick={applyAutoFill}
                      className="w-full mt-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-slate-950 rounded-md text-[10px] font-bold transition-colors"
                    >
                      Apply Suggestions
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Extracted Tasks Review */}
            {extractedTasks !== null && (
              <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Review Extracted Tasks ({extractedTasks.length})
                </div>
                {extractedTasks.length > 0 ? (
                  <>
                    <div className="max-h-48 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                      {extractedTasks.map((et) => (
                        <div
                          key={`${et.title}-${et.priority ?? ""}-${et.summary ?? ""}-${et.dueDate ?? ""}`}
                          className="bg-black/40 border border-white/10 rounded-lg p-3 group"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-sm font-bold text-white flex items-center gap-2">
                              <ChevronRight size={14} className="text-red-300" />
                              {et.title}
                            </div>
                            <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] font-bold uppercase">
                              {et.priority}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-1">{et.summary}</p>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleCreateExtractedTasks}
                      className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all"
                    >
                      Create All {extractedTasks.length} Tasks
                    </button>
                  </>
                ) : (
                  <div className="p-6 text-center bg-black/20 border border-dashed border-white/10 rounded-xl">
                    <MessageSquareText size={24} className="mx-auto text-slate-600 mb-2" />
                    <p className="text-sm text-slate-500 italic">
                      AI could not identify any specific tasks in your text. Try providing more
                      detail.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <form id="task-form" onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* Title */}
            <div className="space-y-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">
                  Task Title
                </label>
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
              {duplicateWarning && (
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
                        setRecurring(
                          recurring ? { ...recurring, enabled: false } : undefined,
                        );
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
            </div>

            {/* Custom Fields Section */}
            {customFields.length > 0 && (
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
            )}

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
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ ...props }) => (
                          <a
                            {...props}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-red-400 hover:underline"
                          />
                        ),
                      }}
                    >
                      {formData.summary}
                    </ReactMarkdown>
                  ) : (
                    <span className="text-slate-600 italic">No description to preview.</span>
                  )}
                </div>
              )}
            </div>

            {/* Links & Dependencies */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                <Link size={12} /> Linked Tasks & Dependencies
              </label>
              <div className="flex gap-2">
                <Tooltip content="Select link type" position="top">
                  <select
                    value={newLinkType}
                    onChange={(e) => setNewLinkType(e.target.value)}
                    className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
                    aria-label="Link type"
                  >
                    <option value="relates-to" className="bg-navy-900">
                      Relates to
                    </option>
                    <option value="blocks" className="bg-navy-900">
                      Blocks
                    </option>
                    <option value="blocked-by" className="bg-navy-900">
                      Blocked By
                    </option>
                    <option value="duplicates" className="bg-navy-900">
                      Duplicates
                    </option>
                  </select>
                </Tooltip>
                <Tooltip content="Select task to link" position="top">
                  <select
                    value={newLinkTarget}
                    onChange={(e) => setNewLinkTarget(e.target.value)}
                    className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
                    aria-label="Select task to link"
                  >
                    <option value="" className="bg-navy-900">
                      Select Task...
                    </option>
                    {availableTasks
                      .filter((t) => t.id !== initialData?.id)
                      .map((t) => (
                        <option key={t.id} value={t.id} className="bg-navy-900">
                          [{t.jobId}] {t.title}
                        </option>
                      ))}
                  </select>
                </Tooltip>
                <Tooltip content="Add task link" position="top">
                  <button
                    type="button"
                    onClick={handleAddTaskLink}
                    className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
                    aria-label="Add task link"
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
              <div className="space-y-2 mt-2">
                {links.map((link) => {
                  const target = availableTasks.find((t) => t.id === link.targetTaskId);
                  if (!target) return null;
                  return (
                    <div
                      key={`${link.type}-${link.targetTaskId}`}
                      className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0a] border border-white/10 group hover:border-white/20 hover:bg-white/5 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-1.5 rounded-lg uppercase font-bold text-[10px] tracking-wide border flex items-center gap-1.5
                                        ${
                                          link.type === "blocked-by"
                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                            : link.type === "blocks"
                                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                              : link.type === "duplicates"
                                                ? "bg-slate-500/10 text-slate-300 border-slate-500/20"
                                                : "bg-slate-500/10 text-slate-300 border-slate-500/20"
                                        }`}
                        >
                          {getLinkIcon(link.type)}
                          {link.type.replace("-", " ")}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-xs font-mono text-slate-500">{target.jobId}</span>
                          <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">
                            {target.title}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveTaskLink(link.targetTaskId)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <span className="text-xs font-medium">Unlink</span>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                {links.length === 0 && (
                  <div className="text-center py-4 text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">
                    No linked tasks
                  </div>
                )}
              </div>
            </div>

            {/* DevCouncil provenance — self-hides for non-DevCouncil-planned tasks. */}
            {initialData && <TaskEvidencePanel task={initialData} />}

            {/* Subtasks */}
            <div className="space-y-3">
              <div className="flex items-center justify-between pl-1">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <CheckSquare size={12} /> Subtasks
                </label>
                <Tooltip content="AI Breakdown - Generate subtasks" position="top">
                  <button
                    type="button"
                    onClick={handleAiBreakdown}
                    disabled={isBreakingDown || !formData.title.trim()}
                    className="text-[10px] font-bold text-red-300 hover:text-red-200 flex items-center gap-1 transition-colors"
                  >
                    {isBreakingDown ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Sparkles size={10} />
                    )}
                    AI Breakdown
                  </button>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddSubtask();
                    }
                  }}
                  placeholder="Add a subtask..."
                  className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm"
                  aria-label="New subtask title"
                />
                <Tooltip content="Add subtask" position="top">
                  <button
                    type="button"
                    onClick={handleAddSubtask}
                    className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
                    aria-label="Add subtask"
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors"
                  >
                    <Tooltip
                      content={subtask.completed ? "Mark as incomplete" : "Mark as complete"}
                      position="top"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSubtask(subtask.id)}
                        className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${subtask.completed ? "bg-emerald-500/20 border-emerald-500 text-emerald-500" : "border-slate-600 text-transparent hover:border-slate-400"}`}
                        aria-label={
                          subtask.completed
                            ? `Mark subtask "${subtask.title}" as incomplete`
                            : `Mark subtask "${subtask.title}" as complete`
                        }
                      >
                        <Check size={12} aria-hidden="true" />
                      </button>
                    </Tooltip>
                    <input
                      type="text"
                      value={subtask.title}
                      onChange={(e) => handleUpdateSubtask(subtask.id, e.target.value)}
                      className={`flex-1 bg-transparent border-none outline-none text-sm font-medium focus:text-white transition-colors ${subtask.completed ? "text-slate-500 line-through decoration-slate-600" : "text-slate-300"}`}
                      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                      aria-label={`Edit subtask ${subtask.id}`}
                      placeholder="Subtask title"
                    />
                    <Tooltip content={`Remove subtask "${subtask.title}"`} position="top">
                      <button
                        type="button"
                        onClick={() => handleRemoveSubtask(subtask.id)}
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all"
                        aria-label={`Remove subtask "${subtask.title}"`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>

            {/* Attachments */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                <Paperclip size={12} /> Attachments
              </label>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLinkName}
                    onChange={(e) => setNewLinkName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddLink();
                      }
                    }}
                    placeholder="Link Name (Optional)"
                    className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-sm"
                    aria-label="Link name (optional)"
                  />
                  <input
                    type="text"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddLink();
                      }
                    }}
                    placeholder="https://..."
                    className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm"
                    aria-label="Link URL"
                  />
                  <Tooltip content="Add Link" position="top">
                    <button
                      type="button"
                      onClick={handleAddLink}
                      className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
                      aria-label="Add link"
                    >
                      <LinkIcon size={18} aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Upload File" position="top">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
                      aria-label="Upload file"
                    >
                      <Upload size={18} aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileUpload}
                    aria-label="Upload file attachment"
                  />
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors"
                  >
                    <div className="p-1.5 rounded-lg bg-white/5 text-slate-400">
                      {att.type === "file" ? <Paperclip size={14} /> : <LinkIcon size={14} />}
                    </div>

                    {(() => {
                      const safeUrl = att.type === "file" ? att.url : getSafeExternalUrl(att.url);
                      const isSafe = Boolean(safeUrl);
                      return (
                        <Tooltip content={safeUrl ?? "Unsafe URL blocked"} position="top">
                          <a
                            href={safeUrl ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex-1 text-sm font-medium truncate underline decoration-red-500/30 hover:decoration-red-400 ${isSafe ? "text-red-400 hover:text-red-300" : "text-slate-500 cursor-not-allowed decoration-slate-500/30"}`}
                            onClick={(e) => !isSafe && e.preventDefault()}
                          >
                            {att.name}
                          </a>
                        </Tooltip>
                      );
                    })()}
                    <Tooltip content={`Remove attachment "${att.name}"`} position="top">
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(att.id)}
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all"
                        aria-label={`Remove attachment "${att.name}"`}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "activity" && (
        <div className="flex flex-col h-full min-h-[400px]">
          <div className="space-y-4 p-1">
            {initialData?.activity
              ?.slice()
              .reverse()
              .map((item, idx) => (
                <div key={item.id || idx} className="flex gap-4 group">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-2 h-2 rounded-full mt-2 ${
                        item.type === "create"
                          ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                          : item.type === "move"
                            ? "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]"
                            : item.type === "delete"
                              ? "bg-red-500"
                              : "bg-slate-500"
                      }`}
                    />
                    {idx !== (initialData.activity?.length || 0) - 1 && (
                      <div className="w-px h-full bg-white/10 my-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        {item.type}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {(() => {
                          const ts = new Date(item.timestamp);
                          return Number.isNaN(ts.getTime()) ? "Unknown date" : ts.toLocaleString();
                        })()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 bg-white/5 p-3 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
                      {item.details}
                    </p>
                  </div>
                </div>
              )) || (
              <div className="text-center text-slate-500 py-10 italic">No activity recorded.</div>
            )}
          </div>
        </div>
      )}
    </ModalWrapper>
  );
};

const QuickAddHint: React.FC<{ label: string; description: string }> = ({ label, description }) => (
  <div className="flex items-center gap-1 text-[10px]">
    <kbd className="px-1.5 py-0.5 liquid-glass rounded-md text-white/80 font-mono border border-white/10">
      {label}
    </kbd>
    <span className="text-slate-500">{description}</span>
  </div>
);

function quickAddTokenClass(kind: QuickAddTokenKind): string {
  switch (kind) {
    case "title":
      return "text-red-300";
    case "priority":
      return "text-red-400 font-bold";
    case "date":
      return "text-slate-200";
    case "file":
      return "text-slate-300 underline decoration-white/20";
    case "project":
      return "text-slate-300";
    case "tag":
      return "text-slate-400";
    case "assignee":
      return "text-slate-200";
    case "estimate":
      return "text-slate-300";
    default:
      return "text-slate-500";
  }
}
