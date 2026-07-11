import {
  Image as ImageIcon,
  AlertTriangle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Flag,
  HelpCircle,
  Layers,
  Loader2,
  MessageSquareText,
  Plus,
  Sparkles,
  Tag,
  User,
  Wand2,
  X,
} from "lucide-react";
import type React from "react";
import { getBatchLineStatus, resolveParsedPriority } from "../../utils/taskParser";
import type { PriorityDefinition, Project, Task } from "../../../types";
import type { UseTaskFormReturn } from "../../hooks/useTaskForm";
import { QuickAddPreview } from "../QuickAddPreview";
import { QuickAddHint } from "./QuickAddHint";

interface AiAssistPanelProps {
  form: UseTaskFormReturn;
  initialData?: Task | null;
  aiFeaturesEnabled: boolean;
  priorities: PriorityDefinition[];
  allProjects: Project[];
  availableTasks: Task[];
}

export const AiAssistPanel: React.FC<AiAssistPanelProps> = ({
  form,
  initialData,
  aiFeaturesEnabled,
  priorities,
  allProjects,
  availableTasks,
}) => {
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
  } = form;

  return (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-3">
            <label htmlFor="ai-input" className="flex items-center gap-2 text-sm font-bold text-red-300">
              {aiFeaturesEnabled ? (
                <>
                  <Sparkles size={16} /> AI Assistant
                </>
              ) : (
                <>Quick Add</>
              )}
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
                    Relative dates: <span className="text-slate-500">@tomorrow</span>, <span className="text-slate-500">@in 3 days</span>, <span className="text-slate-500">@eod</span> (5pm), <span className="text-slate-500">@5pm</span>, <span className="text-slate-500">@next monday</span>
                  </p>
                  <p>
                    Agents <span className="text-slate-500">%agent</span>; project override <span className="text-slate-500">#project:Name</span>; description <span className="text-slate-500">:: body</span>; Up-arrow recalls recent entries
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2 relative">
              {imagePreview && aiFeaturesEnabled && (
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
                  setQuickAddHistoryIndex(-1);
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
                  if (
                    e.key === "ArrowUp" &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    quickAddCompletions.length === 0 &&
                    !initialData
                  ) {
                    const el = e.target as HTMLTextAreaElement;
                    const atLineStart = el.selectionStart === 0 && el.selectionEnd === 0;
                    if (atLineStart && recentQuickAdds.length > 0) {
                      e.preventDefault();
                      cycleQuickAddHistory("up");
                      return;
                    }
                  }
                  if (
                    e.key === "ArrowDown" &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    quickAddCompletions.length === 0 &&
                    quickAddHistoryIndex >= 0
                  ) {
                    e.preventDefault();
                    cycleQuickAddHistory("down");
                    return;
                  }
                  if (e.key === "Escape" && aiInput.trim()) {
                    e.preventDefault();
                    e.stopPropagation();
                    setAiInput("");
                    setAiInputCursor(0);
                    setQuickAddHistoryIndex(-1);
                    quickAddHistoryDraftRef.current = "";
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
                    ? aiFeaturesEnabled
                      ? 'Refine with AI, or quick-add: $"Title Here" !h @file.ts +tag @tom'
                      : 'Quick-add: $"Title Here" !h @file.ts +tag @tom'
                    : suggestedQuickAddMetadata
                      ? aiFeaturesEnabled
                        ? `Quick-add: $Title ${suggestedQuickAddMetadata} — or describe tasks for AI extract`
                        : `Quick-add: $Title ${suggestedQuickAddMetadata}`
                      : aiFeaturesEnabled
                        ? "Quick-add: $Title !h @src/file.ts +tag @tom %agent — or describe tasks for AI extract"
                        : "Quick-add: $Title !h @src/file.ts +tag @tom"
                }
                className="w-full liquid-input border border-red-500/20 rounded-lg px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/50 min-h-[80px] max-h-60 resize-none overflow-y-auto font-mono"
              />

              {showQuickAddPreview &&
                (quickAddSyntaxSegments.length > 0 || parsedAiInput || quickAddWarnings.length > 0) && (
                <QuickAddPreview
                  syntaxSegments={quickAddSyntaxSegments}
                  parsed={parsedAiInput}
                  warnings={quickAddWarnings}
                  priorities={priorities}
                  projects={allProjects}
                  matchProjectByName={matchProjectByName}
                  priorityPreviewStyle={priorityPreviewStyle}
                  onCopyPreview={parsedAiInput ? () => void handleCopyParsedPreview() : undefined}
                />
              )}

              {!aiInput.trim() && lastCreateAllBatch && !initialData && (
                <button
                  type="button"
                  onClick={() => {
                    setAiInput(lastCreateAllBatch);
                    setAiInputCursor(lastCreateAllBatch.length);
                    requestAnimationFrame(() => {
                      aiInputRef.current?.focus();
                      aiInputRef.current?.setSelectionRange(
                        lastCreateAllBatch.length,
                        lastCreateAllBatch.length,
                      );
                    });
                  }}
                  className="self-start px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                >
                  Retry Last Batch
                </button>
              )}

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
                    {aiInput.trim() && (
                      <button
                        type="button"
                        onClick={handleSaveQuickAddTemplate}
                        className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-slate-500 hover:text-white hover:bg-white/5 border border-white/10 transition-colors"
                        title="Save current input as a named template"
                      >
                        Save
                      </button>
                    )}
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

              {savedTemplates.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold shrink-0">
                    Library
                  </span>
                  {savedTemplates.map((template) => (
                    <div key={template.id} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAiInput(template.content);
                          setAiInputCursor(template.content.length);
                          requestAnimationFrame(() => {
                            aiInputRef.current?.focus();
                            aiInputRef.current?.setSelectionRange(
                              template.content.length,
                              template.content.length,
                            );
                          });
                        }}
                        className="truncate max-w-[140px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-mono text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                        title={template.content}
                      >
                        {template.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteQuickAddTemplate(template.id)}
                        className="p-0.5 rounded text-slate-600 hover:text-red-400 transition-colors"
                        aria-label={`Delete template ${template.name}`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
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

              {aiFeaturesEnabled && refinePresetChain.length > 0 && (
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

              {aiFeaturesEnabled && (
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
              )}

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
                    className="liquid-button flex-1 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="liquid-button flex-1 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                {aiFeaturesEnabled && !initialData && (
                  <button
                    type="button"
                    onClick={handleExtractTasks}
                    disabled={isExtracting || !aiInput.trim() || aiAssistantMode === "Quick Add"}
                    className="liquid-button flex-1 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExtracting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FileText size={16} />
                    )}
                    Extract Tasks
                  </button>
                )}
                {aiFeaturesEnabled && (
                <button
                  type="button"
                  onClick={() => handleAiRefine()}
                  disabled={
                    isGenerating ||
                    aiAssistantMode === "Quick Add" ||
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
                )}
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
            {aiFeaturesEnabled && !initialData && availableTasks.length > 1 && (
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
                      className="liquid-button w-full mt-2 px-3 py-1.5 rounded-md text-[10px] font-bold disabled:opacity-50"
                    >
                      Apply Suggestions
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Extracted Tasks Review */}
            {aiFeaturesEnabled && extractedTasks !== null && (
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
  );
};
