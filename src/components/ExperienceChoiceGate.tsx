import { Bot, Kanban } from "lucide-react";
import type React from "react";
import logo from "../assets/logo.png";

interface ExperienceChoiceGateProps {
  onChoose: (aiFeaturesEnabled: boolean) => void;
}

/**
 * First-run gate: user picks simple Kanban task management or the full AI Agent
 * Board experience. Blocks the shell until a choice is made (no dismiss).
 */
export const ExperienceChoiceGate: React.FC<ExperienceChoiceGateProps> = ({ onChoose }) => {
  return (
    <div className="min-h-screen bg-[#030000] flex items-center justify-center p-6">
      <div
        className="w-full max-w-2xl liquid-glass rounded-3xl border border-red-500/20 p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500"
        role="dialog"
        aria-modal="true"
        aria-labelledby="experience-choice-title"
      >
        <div className="flex flex-col items-center text-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-14 h-14 object-contain" />
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Welcome</p>
            <h1 id="experience-choice-title" className="text-2xl font-bold text-white mt-1">
              Choose Your Experience
            </h1>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-md mx-auto">
              Pick how you want to use LiquiTask. You can change this later in Settings &gt;
              General.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose(false)}
            className="liquid-card group flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition-all hover:border-white/20 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 group-hover:text-red-300">
                <Kanban size={20} aria-hidden="true" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                Simplified
              </span>
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-white">Simple Task Management</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Kanban boards, projects, and search — without AI assistants, insights, or the
                agent board.
              </p>
            </div>
            <span className="mt-auto w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-white transition-colors group-hover:bg-white/10">
              Use Simple Mode
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChoose(true)}
            className="liquid-card group flex flex-col items-start gap-3 rounded-2xl border border-red-500/25 bg-red-500/5 p-5 text-left transition-all hover:border-red-500/40 hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <div className="flex items-center gap-2">
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-300">
                <Bot size={20} aria-hidden="true" />
              </div>
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                Full Experience
              </span>
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-white">AI Agent Board</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Everything in simple mode plus AI assistant, insights, quick-add AI, and agent
                runs on your board.
              </p>
            </div>
            <span className="liquid-button mt-auto w-full rounded-xl px-4 py-2.5 text-sm font-bold">
              Enable AI Agent Board
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExperienceChoiceGate;
