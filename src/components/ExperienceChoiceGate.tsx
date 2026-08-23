import { Bot, Kanban, Sparkles } from "lucide-react";
import type React from "react";
import logo from "../assets/logo.png";

/** The two preferences the first-run gate sets; both are editable later. */
export interface ExperienceChoice {
  aiFeaturesEnabled: boolean;
  agentExecutionEnabled: boolean;
}

interface ExperienceChoiceGateProps {
  onChoose: (choice: ExperienceChoice) => void;
}

interface ExperienceOption {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  icon: React.ReactNode;
  choice: ExperienceChoice;
  accent: boolean;
}

const OPTIONS: ExperienceOption[] = [
  {
    id: "simple",
    eyebrow: "Simplified",
    title: "Simple Task Management",
    description:
      "Kanban boards, projects, and search — without AI assistants, insights, or the agent board.",
    cta: "Use Simple Mode",
    icon: <Kanban size={20} aria-hidden="true" />,
    choice: { aiFeaturesEnabled: false, agentExecutionEnabled: false },
    accent: false,
  },
  {
    id: "assisted",
    eyebrow: "Assisted",
    title: "AI Assisted Board",
    description:
      "Kanban plus the AI assistant, insights, and quick-add AI — no agents run in the background.",
    cta: "Use AI Assist",
    icon: <Sparkles size={20} aria-hidden="true" />,
    choice: { aiFeaturesEnabled: true, agentExecutionEnabled: false },
    accent: false,
  },
  {
    id: "agents",
    eyebrow: "Full Experience",
    title: "AI Agent Board",
    description:
      "Everything in AI assist plus coding-agent runs, approvals, and the Inbox and Agents surfaces.",
    cta: "Enable AI Agent Board",
    icon: <Bot size={20} aria-hidden="true" />,
    choice: { aiFeaturesEnabled: true, agentExecutionEnabled: true },
    accent: true,
  },
];

/**
 * First-run gate: user picks simple Kanban, AI-assisted Kanban, or the full
 * agent board. Blocks the shell until a choice is made (no dismiss).
 */
export const ExperienceChoiceGate: React.FC<ExperienceChoiceGateProps> = ({ onChoose }) => {
  return (
    <div className="min-h-screen bg-[#030000] flex items-center justify-center p-6">
      <div
        className="w-full max-w-4xl liquid-glass rounded-3xl border border-red-500/20 p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500"
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
              Pick how you want to use LiquiTask. AI assistance and agent execution are separate
              switches — change either later in Settings &gt; General.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onChoose(option.choice)}
              className={`liquid-card group flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all focus:outline-none ${
                option.accent
                  ? "border-red-500/25 bg-red-500/5 hover:border-red-500/40 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500"
                  : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`rounded-xl p-2 ${
                    option.accent
                      ? "border border-red-500/30 bg-red-500/10 text-red-300"
                      : "border border-white/10 bg-white/5 text-slate-300 group-hover:text-red-300"
                  }`}
                >
                  {option.icon}
                </div>
                <span className="text-[10px] uppercase tracking-widest text-slate-500">
                  {option.eyebrow}
                </span>
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-white">{option.title}</h2>
                <p className="text-xs text-slate-400 leading-relaxed">{option.description}</p>
              </div>
              <span
                className={
                  option.accent
                    ? "liquid-button mt-auto w-full rounded-xl px-4 py-2.5 text-sm font-bold text-center"
                    : "mt-auto w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-white text-center transition-colors group-hover:bg-white/10"
                }
              >
                {option.cta}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ExperienceChoiceGate;
