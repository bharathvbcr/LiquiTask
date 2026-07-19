import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "../../../../types";
import { AgentForm } from "../AgentForm";

const mockSkills = [
  {
    id: "skill-1",
    title: "React Testing",
    summary: "Patterns for component tests with Vitest",
    workingDir: "/repo",
    createdAt: new Date(),
  },
  {
    id: "skill-2",
    title: "Rust FFI",
    summary: "Bridging Tauri commands to native code",
    workingDir: "/repo",
    createdAt: new Date(),
  },
];

// Runtime detection catalog drives the provider picker.
const detectRuntimesCached = vi.fn(async () => [
  { id: "codex", name: "Codex", binary: "codex", version: "1.2.3", ready: true },
]);
vi.mock("../../../core/api/localApi", () => ({
  localApi: {
    detectRuntimesCached: (...args: unknown[]) => detectRuntimesCached(...args),
    listSkills: vi.fn(async () => undefined),
  },
}));

// No desktop bridge in jsdom — keep every native probe inert.
vi.mock("../../../runtime/runtimeEnvironment", () => ({
  isTauri: () => false,
  getDesktopApi: () => null,
}));

vi.mock("../../../services/agents/agentRunService", () => ({
  default: {
    detectClis: vi.fn(async () => []),
  },
}));

vi.mock("../../../services/agents/agentSkillsService", () => ({
  default: {
    getSkills: () => mockSkills,
  },
}));

// Heavy settings sub-panels aren't under test; stub them out.
vi.mock("../../settings/DevCouncilPanel", () => ({
  DevCouncilPanel: () => null,
}));
vi.mock("../../settings/AgentSkillsLibrary", () => ({
  AgentSkillsLibrary: () => null,
}));
vi.mock("../../settings/SettingsToggle", () => ({
  SettingsToggle: ({
    checked,
    onChange,
    "aria-label": ariaLabel,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    "aria-label": string;
  }) => (
    <input
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));

function makeDraft(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "a1",
    name: "Claude",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: false,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    createdAt: new Date(),
    ...overrides,
  } as AgentProfile;
}

describe("AgentForm", () => {
  afterEach(() => {
    detectRuntimesCached.mockClear();
  });

  it("renders the agent name and forwards edits through onChange", () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );
    const nameInput = screen.getByPlaceholderText("e.g. Claude") as HTMLInputElement;
    expect(nameInput.value).toBe("Claude");

    fireEvent.change(nameInput, { target: { value: "Codey" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Codey" }));
  });

  it("populates the runtime picker from detected runtimes and selects one", async () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );

    // The default native runner is always present.
    expect(
      screen.getByRole("option", { name: "Claude Code (native runner)" }),
    ).toBeInTheDocument();

    // Detected runtimes load asynchronously.
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Codex/ })).toBeInTheDocument();
    });

    const runtimeSelect = screen.getByDisplayValue("Claude Code (native runner)");
    fireEvent.change(runtimeSelect, { target: { value: "codex" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ provider: "codex" }));
  });

  it("shows the agentd sidecar note when a non-native runtime is selected", () => {
    render(
      <AgentForm
        draft={makeDraft({ provider: "codex" })}
        onChange={vi.fn()}
        workspacePaths={[]}
        addToast={vi.fn()}
      />,
    );
    expect(screen.getByText(/Runs via the agentd sidecar/)).toBeInTheDocument();
  });

  it("shows advisor model picker for Claude Code workers and forwards changes", () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );
    expect(screen.getByText("Advisor model (optional)")).toBeInTheDocument();
    expect(screen.getByText(/Sonnet main \+ Opus advisor/)).toBeInTheDocument();
    expect(screen.getByText(/Fable advisor needs ≥2\.1\.170/)).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/Off — leave blank/);
    fireEvent.change(input, { target: { value: "opus" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ advisorModel: "opus" }));
  });

  it("hides advisor model picker for planner role", () => {
    render(
      <AgentForm
        draft={makeDraft({ role: "planner", advisorModel: "opus" })}
        onChange={vi.fn()}
        workspacePaths={[]}
        addToast={vi.fn()}
      />,
    );
    expect(screen.queryByText("Advisor model (optional)")).not.toBeInTheDocument();
  });

  it("hides advisor model picker for non-Claude runtimes", () => {
    render(
      <AgentForm
        draft={makeDraft({ provider: "codex", advisorModel: "opus" })}
        onChange={vi.fn()}
        workspacePaths={[]}
        addToast={vi.fn()}
      />,
    );
    expect(screen.queryByText("Advisor model (optional)")).not.toBeInTheDocument();
  });

  it("clamps a negative daily cost cap to zero", () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );
    // Both the daily and per-run caps use the "No cap" placeholder; the daily
    // cap is the first.
    const capInput = screen.getAllByPlaceholderText("No cap")[0];
    fireEvent.change(capInput, { target: { value: "-10" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dailyCostCapUsd: 0 }));
  });

  it("clears the daily cost cap when the field is emptied", () => {
    const onChange = vi.fn();
    render(
      <AgentForm
        draft={makeDraft({ dailyCostCapUsd: 5 })}
        onChange={onChange}
        workspacePaths={[]}
        addToast={vi.fn()}
      />,
    );
    const capInput = screen.getByDisplayValue("5");
    fireEvent.change(capInput, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dailyCostCapUsd: undefined }));
  });

  it("renders every permission mode option", () => {
    render(
      <AgentForm draft={makeDraft()} onChange={vi.fn()} workspacePaths={[]} addToast={vi.fn()} />,
    );
    expect(screen.getByRole("option", { name: /Plan only/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Accept edits/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Bypass permissions/ })).toBeInTheDocument();
  });

  it("toggles auto-pickup through onChange", () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Toggle auto-pickup"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoPickup: true }));
  });

  it("defaults the working directory to the linked workspace folder", async () => {
    const onChange = vi.fn();
    render(
      <AgentForm
        draft={makeDraft({ workingDir: "" })}
        onChange={onChange}
        workspacePaths={["/Users/me/Code/LiquiTask"]}
        addToast={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ workingDir: "/Users/me/Code/LiquiTask" }),
      );
    });
  });

  it("filters pinned skills by search query", async () => {
    render(
      <AgentForm draft={makeDraft()} onChange={vi.fn()} workspacePaths={[]} addToast={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Skills/i }));

    await waitFor(() => {
      expect(screen.getByText("React Testing")).toBeInTheDocument();
      expect(screen.getByText("Rust FFI")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Search skills"), {
      target: { value: "react" },
    });

    expect(screen.getByText("React Testing")).toBeInTheDocument();
    expect(screen.queryByText("Rust FFI")).not.toBeInTheDocument();
  });

  it("edits toolPolicy entries through onChange", () => {
    const onChange = vi.fn();
    render(
      <AgentForm draft={makeDraft()} onChange={onChange} workspacePaths={[]} addToast={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tool policy/i }));
    fireEvent.click(screen.getByRole("button", { name: "+ Bash" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ toolPolicy: { Bash: "ask" } }),
    );
  });

  it("updates an existing toolPolicy action", () => {
    const onChange = vi.fn();
    render(
      <AgentForm
        draft={makeDraft({ toolPolicy: { Bash: "ask" } })}
        onChange={onChange}
        workspacePaths={[]}
        addToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Tool policy/i }));
    fireEvent.change(screen.getByLabelText("Policy for Bash"), { target: { value: "allow" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ toolPolicy: { Bash: "allow" } }),
    );
  });
});
