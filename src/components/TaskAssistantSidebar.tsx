import {
  Brain,
  FolderOpen,
  Link,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  Unlink,
  X,
  Bot,
  User as UserIcon,
  Loader2,
  Plus,
} from "lucide-react";
import type React from "react";
import { useState, useRef, useEffect } from "react";
import type { AssistantMessage, Project } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";


interface TaskAssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: AssistantMessage[];
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  isSearching?: boolean;
  activeTool?: string | null;
  onClearChat: () => void;
  activeProject?: Project;
  onUpdateProjectPaths?: (projectId: string, paths: string[]) => void;
}

const QUICK_ACTIONS = [
  { label: "Summarize today's tasks", icon: RefreshCw },
  { label: "Find blockers", icon: Sparkles },
  { label: "Help me plan my day", icon: Brain },
];

export const TaskAssistantSidebar: React.FC<TaskAssistantSidebarProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
  isLoading,
  isSearching,
  activeTool,
  onClearChat,
  activeProject,
  onUpdateProjectPaths,
}) => {
  const [input, setInput] = useState("");
  const [globalPaths, setGlobalPaths] = useState<string[]>([]);
  const [showPathPanel, setShowPathPanel] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const projectPaths = activeProject?.workspacePaths ?? [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      window.electronAPI?.workspace.getPaths().then(setGlobalPaths).catch(() => {});
    }
  }, [messages, isLoading, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleAddFolder = async () => {
    const path = await window.electronAPI?.workspace.selectDirectory();
    if (!path || !activeProject || !onUpdateProjectPaths) return;

    // Ensure it's in the global pool
    if (!globalPaths.includes(path)) {
      const updated = [...globalPaths, path];
      await window.electronAPI?.workspace.setPaths(updated).catch(() => {});
      setGlobalPaths(updated);
    }

    if (!projectPaths.includes(path)) {
      onUpdateProjectPaths(activeProject.id, [...projectPaths, path]);
    }
  };

  const handleLinkPath = (path: string) => {
    if (!activeProject || !onUpdateProjectPaths || projectPaths.includes(path)) return;
    onUpdateProjectPaths(activeProject.id, [...projectPaths, path]);
  };

  const handleUnlinkPath = (path: string) => {
    if (!activeProject || !onUpdateProjectPaths) return;
    onUpdateProjectPaths(activeProject.id, projectPaths.filter(p => p !== path));
  };

  const unlinkedGlobalPaths = globalPaths.filter(p => !projectPaths.includes(p));

  const SUGGESTIONS = ["Tell me more", "Explain this", "What's next?", "Show blockers"];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60] transition-all duration-700 ease-in-out ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`fixed right-0 top-14 bottom-0 w-full max-w-md liquid-glass border border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] z-[70] flex flex-col rounded-l-[28px] transition-all duration-700 ease-[cubic-bezier(0.05,0.7,0.1,1.0)] ${
          isOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight leading-tight">AI Assistant</h2>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold">
                  {activeProject ? activeProject.name : "Workspace Intelligence"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowPathPanel(v => !v)}
              className={`p-2.5 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95 ${
                showPathPanel
                  ? "text-red-400 bg-red-500/10 border border-red-500/20"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              title="Manage workspace paths"
            >
              <FolderOpen size={18} />
            </button>
            <button
              onClick={onClearChat}
              className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95"
              title="Clear chat history"
            >
              <Trash2 size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all duration-300 hover:scale-105 active:scale-95"
              aria-label="Close assistant"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Path Management Panel */}
        {showPathPanel && (
          <div className="px-6 py-4 border-b border-white/5 bg-white/[0.01] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                Linked to "{activeProject?.name ?? 'Project'}"
              </span>
              <button
                onClick={handleAddFolder}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Plus size={10} />
                Add Folder
              </button>
            </div>

            {projectPaths.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">No folders linked. Add a folder or link from global paths below.</p>
            ) : (
              <div className="space-y-1.5">
                {projectPaths.map(p => (
                  <div key={p} className="flex items-center gap-2 group">
                    <span
                      className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/5 border border-red-500/10 rounded-lg text-[10px] text-red-400/80 font-mono truncate"
                      title={p}
                    >
                      <FolderOpen size={10} className="shrink-0 opacity-70" />
                      {p.split(/[\\/]/).pop()}
                    </span>
                    <button
                      onClick={() => handleUnlinkPath(p)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Unlink from project"
                    >
                      <Unlink size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {unlinkedGlobalPaths.length > 0 && (
              <>
                <div className="pt-1 border-t border-white/5">
                  <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Available to link</span>
                </div>
                <div className="space-y-1.5">
                  {unlinkedGlobalPaths.map(p => (
                    <div key={p} className="flex items-center gap-2 group">
                      <span
                        className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.03] border border-white/5 rounded-lg text-[10px] text-slate-400/70 font-mono truncate"
                        title={p}
                      >
                        <FolderOpen size={10} className="shrink-0 opacity-50" />
                        {p.split(/[\\/]/).pop()}
                      </span>
                      <button
                        onClick={() => handleLinkPath(p)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Link to project"
                      >
                        <Link size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Active Context Indicator (when panel is closed) */}
        {!showPathPanel && projectPaths.length > 0 && (
          <div className="px-6 py-3 border-b border-white/5 flex items-center gap-2 flex-wrap bg-white/[0.01]">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold shrink-0">In Context:</span>
            {projectPaths.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/5 border border-red-500/10 rounded-lg text-[10px] text-red-400/80 font-mono truncate max-w-[140px] hover:border-red-500/30 transition-colors cursor-default"
                title={p}
              >
                <FolderOpen size={10} className="shrink-0 opacity-70" />
                {p.split(/[\\/]/).pop()}
              </span>
            ))}
          </div>
        )}

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar scrollbar-hide">
          {messages.length === 0 && (
            <div
              className={`h-full flex flex-col items-center justify-center text-center space-y-8 px-4 transition-all duration-700 delay-200 ${
                isOpen ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              }`}
            >
              <div className="relative">
                <div className="absolute inset-0 bg-red-500/10 blur-2xl rounded-full animate-pulse" />
                <div className="relative w-24 h-24 rounded-[2rem] liquid-glass border border-white/10 flex items-center justify-center shadow-2xl overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <Sparkles
                    size={48}
                    className="text-red-400 relative z-10 drop-shadow-[0_2px_8px_rgba(239,68,68,0.4)] group-hover:scale-110 transition-transform duration-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-white tracking-tight">Welcome to LiquiTask AI</h3>
                <p className="text-sm text-slate-400 max-w-[280px] leading-relaxed">
                  Your intelligent partner for summarizing tasks, finding bottlenecks, and organizing your workspace.
                </p>
              </div>

              <div className="grid gap-3 w-full max-w-[320px]">
                {QUICK_ACTIONS.map((action, idx) => (
                  <button
                    key={action.label}
                    onClick={() => onSendMessage(action.label)}
                    className="flex items-center gap-4 p-4 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-red-500/20 rounded-2xl text-left transition-all duration-300 group hover:-translate-y-0.5 animate-slide-in-up"
                    style={{ animationDelay: `${idx * 100}ms` }}
                  >
                    <div className="p-2.5 rounded-xl bg-white/5 text-slate-400 group-hover:bg-red-500/10 group-hover:text-red-400 transition-colors">
                      <action.icon size={18} />
                    </div>
                    <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(() => {
            const visibleMessages = messages.filter((msg) => msg.role !== "function");
            return visibleMessages.map((msg, idx) => {
              const showContent = !!msg.content;
              const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
              const isUser = msg.role === "user";
              const isLast = idx === visibleMessages.length - 1;

              if (!showContent && !hasToolCalls) return null;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-4 animate-slide-in-up ${isUser ? "flex-row-reverse" : "flex-row"}`}
                  style={{ animationDelay: '100ms' }}
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-sm ${
                    isUser
                      ? "bg-white/5 border-white/10 text-slate-400"
                      : "bg-red-500/10 border-red-500/20 text-red-400"
                  }`}>
                    {isUser ? <UserIcon size={18} /> : <Bot size={18} />}
                  </div>
                  <div className={`flex flex-col max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      isUser
                        ? "bg-red-500/10 text-red-50 border border-red-500/20 rounded-tr-none"
                        : "bg-white/[0.04] text-slate-200 border border-white/5 rounded-tl-none"
                    }`}>
                      {showContent ? (
                        <div className="markdown-content prose-invert">
                          <MarkdownRenderer content={msg.content} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5 text-slate-400 italic font-medium">
                          <Terminal size={14} className="text-cyan-400 animate-pulse" />
                          <span>Taking action...</span>
                        </div>
                      )}

                      {hasToolCalls && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {msg.toolCalls?.map((call, cidx) => (
                            <span
                              key={cidx}
                              className="px-2.5 py-1 bg-red-500/5 border border-red-500/10 rounded-lg text-[10px] text-red-400/80 font-mono flex items-center gap-1.5"
                            >
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400/50 animate-pulse" />
                              {call.name}()
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2 px-1">
                      <span className="text-[10px] text-slate-500 font-medium opacity-60">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Suggested Replies (only for last assistant message) */}
                    {!isUser && isLast && !isLoading && (
                      <div className="flex flex-wrap gap-2 mt-4 animate-fade-in">
                        {SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            onClick={() => onSendMessage(suggestion)}
                            className="px-3 py-1.5 rounded-full border border-white/10 hover:border-red-500/30 bg-white/5 hover:bg-red-500/5 text-[11px] text-slate-400 hover:text-red-300 transition-all active:scale-95 shadow-sm"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            });
          })()}

          {/* Tool indicators / loading */}
          {(isLoading || isSearching || !!activeTool) && (
            <div
              className={`flex gap-4 transition-all duration-500 ${
                isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
              }`}
            >
              <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                <Bot size={18} className="animate-pulse" />
              </div>
              <div className="bg-white/[0.03] border border-white/5 p-4 rounded-2xl rounded-tl-none flex flex-col gap-3 min-w-[240px] shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="relative w-4 h-4">
                    <Loader2 size={16} className="animate-spin text-red-400 absolute inset-0" />
                    <div className="absolute inset-0 bg-red-400/10 blur-sm rounded-full animate-pulse" />
                  </div>
                  <span className="text-sm text-slate-400 italic font-medium">
                    {activeTool ? `Executing ${activeTool.replace(/_/g, ' ')}...` : isSearching ? "Analyzing workspace context..." : "Synthesizing response..."}
                  </span>
                </div>
                {isSearching && (
                  <div className="flex items-center gap-2.5 px-3 py-1.5 bg-red-500/5 rounded-xl border border-red-500/10 animate-pulse">
                    <Sparkles size={12} className="text-red-400" />
                    <span className="text-[10px] text-red-300/80 font-bold uppercase tracking-wider">Semantic RAG Engine</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6 border-t border-white/5 bg-white/[0.02]">
          <form
            role="form"
            onSubmit={handleSubmit}
            className="group relative"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-red-500/10 to-red-500/5 rounded-[1.25rem] blur opacity-0 group-focus-within:opacity-100 transition duration-500" />
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything..."
                className="w-full bg-black/20 border border-white/5 rounded-[1.25rem] py-4 pl-5 pr-14 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500/30 focus:ring-1 focus:ring-red-500/20 transition-all"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 rounded-xl transition-all duration-300 disabled:opacity-30 active:scale-95"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
          <div className="flex items-center justify-center gap-2 mt-4 opacity-30">
            <Sparkles size={10} className="text-red-400" />
            <p className="text-[10px] text-slate-500 font-medium">
              Powered by LiquiTask AI
            </p>
          </div>
        </div>
      </aside>
    </>
  );
};
