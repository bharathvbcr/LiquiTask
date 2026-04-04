import {
  Brain,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
  Bot,
  User as UserIcon,
  Loader2,
} from "lucide-react";
import type React from "react";
import { useState, useRef, useEffect } from "react";
import type { AssistantMessage } from "../../types";
import MarkdownRenderer from "./MarkdownRenderer";

interface TaskAssistantSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  messages: AssistantMessage[];
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  onClearChat: () => void;
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
  onClearChat,
}) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isLoading, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60] transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`fixed right-0 top-0 bottom-0 w-full max-w-md bg-slate-900/90 backdrop-blur-xl border-l border-white/10 shadow-2xl z-[70] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
              <Brain size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">AI Assistant</h2>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Workspace Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClearChat}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
              title="Clear chat history"
            >
              <Trash2 size={18} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
              aria-label="Close assistant"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-8">
              <div className="w-16 h-16 rounded-3xl bg-white/5 flex items-center justify-center text-cyan-400 border border-white/10">
                <MessageSquare size={32} />
              </div>
              <div>
                <h3 className="text-white font-bold">Welcome to LiquiTask AI</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Ask me to summarize tasks, find blockers, or help you organize your workspace.
                </p>
              </div>
              
              <div className="grid gap-2 w-full mt-4">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => onSendMessage(action.label)}
                    className="flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-left text-sm text-slate-300 transition-all group"
                  >
                    <action.icon size={16} className="text-cyan-400 group-hover:scale-110 transition-transform" />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                msg.role === "user" 
                  ? "bg-slate-800 border-white/10 text-slate-300" 
                  : "bg-cyan-500/20 border-cyan-500/20 text-cyan-400"
              }`}>
                {msg.role === "user" ? <UserIcon size={16} /> : <Bot size={16} />}
              </div>
              <div className={`flex flex-col max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`p-3 rounded-2xl text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-tr-none shadow-lg shadow-blue-900/20"
                    : "bg-white/5 text-slate-200 border border-white/5 rounded-tl-none"
                }`}>
                  <MarkdownRenderer content={msg.content} />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
                <Bot size={16} />
              </div>
              <div className="bg-white/5 border border-white/5 p-3 rounded-2xl rounded-tl-none flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-cyan-400" />
                <span className="text-sm text-slate-400 italic">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6 border-t border-white/10 bg-white/5">
          <form 
            role="form" 
            onSubmit={handleSubmit}
            className="relative"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything..."
              className="w-full bg-black/40 border border-white/10 rounded-2xl py-3 pl-4 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-xl transition-all disabled:opacity-50 disabled:grayscale"
            >
              <Send size={18} />
            </button>
          </form>
          <p className="text-[10px] text-slate-500 mt-3 text-center">
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </aside>
    </>
  );
};
