import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider } from "../../contexts/ConfirmationContext";
import storageService from "../../services/storageService";
import { aiService } from "../../services/aiService";
import { TaskFormModal } from "../TaskFormModal";

const renderWithConfirmation = (ui: ReactElement) =>
  render(<ConfirmationProvider>{ui}</ConfirmationProvider>);

// Mock aiService
vi.mock("../../services/aiService", () => ({
  aiService: {
    refineTaskDraft: vi.fn(),
    extractTasksFromText: vi.fn(),
    generateSubtasks: vi.fn(),
    suggestPriorities: vi.fn(),
    suggestMetadata: vi.fn(),
    detectDuplicates: vi.fn(),
    analyzeRedundancy: vi.fn(),
    analyzeImageToTask: vi.fn(),
  },
}));

vi.mock("../../services/storageService", () => ({
  default: {
    get: vi.fn((key: string, fallback: unknown) => {
      if (key === "liquitask-quick-add-recent") {
        return ["$Deploy !h #work", "$Review !h #work", "$Ship !m #work"];
      }
      return fallback;
    }),
    set: vi.fn(),
  },
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  getDesktopApi: vi.fn(() => ({
    workspace: {
      getPaths: vi.fn().mockResolvedValue([]),
      searchFiles: vi.fn().mockResolvedValue([]),
    },
  })),
}));

describe("TaskFormModal AI Integration", () => {
  const mockOnSubmit = vi.fn();
  const mockOnClose = vi.fn();
  const mockProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSubmit: mockOnSubmit,
    projectId: "p1",
    priorities: [{ id: "high", label: "High", color: "red", level: 1 }],
    columns: [{ id: "c1", title: "Pending", color: "gray" }],
    allProjects: [{ id: "p1", name: "Project 1", type: "default" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders AI Action section", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);
    expect(screen.getByText("AI Assistant")).toBeDefined();
    expect(
      screen.getByPlaceholderText(/Quick-add:/),
    ).toBeDefined();
  });

  it("handles Refine Draft action", async () => {
    (aiService.refineTaskDraft as Mock).mockResolvedValue({
      title: "AI Refined Title",
      summary: "AI Refined Summary",
    });

    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const titleInput = screen.getByPlaceholderText("e.g., Update Q3 Financials");
    fireEvent.change(titleInput, { target: { value: "Old Title" } });

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, { target: { value: "Make it better" } });

    const refineButton = screen.getByText("Refine Draft");
    fireEvent.click(refineButton);

    await waitFor(() => {
      expect(aiService.refineTaskDraft).toHaveBeenCalled();
      expect(screen.getByDisplayValue("AI Refined Title")).toBeDefined();
      expect(screen.getByDisplayValue("AI Refined Summary")).toBeDefined();
    });
  });

  it("handles Extract Tasks action", async () => {
    (aiService.extractTasksFromText as Mock).mockResolvedValue([
      { title: "Task 1", summary: "Summary 1", priority: "high", tags: [] },
      { title: "Task 2", summary: "Summary 2", priority: "high", tags: [] },
    ]);

    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "Notes about task 1 and task 2" },
    });

    const extractButton = screen.getByText("Extract Tasks");
    fireEvent.click(extractButton);

    await waitFor(() => {
      expect(screen.getByText("Review Extracted Tasks (2)")).toBeDefined();
      expect(screen.getByText("Task 1")).toBeDefined();
      expect(screen.getByText("Task 2")).toBeDefined();
    });

    const createButton = screen.getByText("Create All 2 Tasks");
    fireEvent.click(createButton);

    expect(mockOnSubmit).toHaveBeenCalledTimes(2);
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
      }),
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("handles AI Breakdown for subtasks", async () => {
    (aiService.generateSubtasks as Mock).mockResolvedValue(["Subtask A", "Subtask B"]);

    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const titleInput = screen.getByPlaceholderText("e.g., Update Q3 Financials");
    fireEvent.change(titleInput, { target: { value: "Main Task" } });

    const breakdownButton = screen.getByText("AI Breakdown");
    fireEvent.click(breakdownButton);

    await waitFor(() => {
      expect(aiService.generateSubtasks).toHaveBeenCalled();
      expect(screen.getByDisplayValue("Subtask A")).toBeDefined();
      expect(screen.getByDisplayValue("Subtask B")).toBeDefined();
    });
  });

  it("handles Polish description", async () => {
    (aiService.refineTaskDraft as Mock).mockResolvedValue({
      summary: "Polished description",
    });

    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const summaryArea = screen.getByPlaceholderText(/Describe the task details/);
    fireEvent.change(summaryArea, { target: { value: "rough draft" } });

    const polishButton = screen.getByText("Polish");
    fireEvent.click(polishButton);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Polished description")).toBeDefined();
    });
  });

  it("applies quick-add syntax to the task form", async () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Fix login bug !h @src/auth.ts +urgent @tom" },
    });

    expect(screen.getByText("Fill Form")).toBeDefined();
    fireEvent.click(screen.getByText("Fill Form"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Fix login bug")).toBeDefined();
    });
  });

  it("creates a task directly from quick-add syntax", async () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Deploy hotfix !h @tom +urgent" },
    });

    fireEvent.click(screen.getByText("Create Now"));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Deploy hotfix",
          priority: "high",
          projectId: "p1",
        }),
      );
      expect(mockOnClose).toHaveBeenCalled();
    });

    expect(aiService.suggestPriorities).not.toHaveBeenCalled();
    expect(aiService.suggestMetadata).not.toHaveBeenCalled();
  });

  it("offers Create All for newline-separated quick-add lines", async () => {
    const mockBulkCreate = vi.fn();
    renderWithConfirmation(<TaskFormModal {...mockProps} onBulkCreateTasks={mockBulkCreate} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Task one !h\n$Task two !m" },
    });

    expect(screen.getByText("Create All (2)")).toBeDefined();
    fireEvent.click(screen.getByText("Create All (2)"));

    await waitFor(() => {
      expect(mockBulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ title: "Task one", priority: "high" }),
          expect.objectContaining({ title: "Task two", priority: "medium" }),
        ]),
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("shows mode hint and undo after Fill Form", async () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Fix login bug !h" },
    });

    expect(screen.getByText("Quick Add")).toBeDefined();
    fireEvent.click(screen.getByText("Fill Form"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Fix login bug")).toBeDefined();
      expect(screen.getByText("Undo")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Undo"));

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Fix login bug")).toBeNull();
      expect(aiInput).toHaveValue("$Fix login bug !h");
    });
  });

  it("warns when parsed title matches an existing task", () => {
    renderWithConfirmation(
      <TaskFormModal
        {...mockProps}
        availableTasks={[
          {
            id: "t1",
            jobId: "J1",
            projectId: "p1",
            title: "Fix login bug",
            subtitle: "",
            summary: "",
            assignee: "",
            priority: "high",
            status: "c1",
            createdAt: new Date(),
            subtasks: [],
            attachments: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0,
          },
        ]}
      />,
    );

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Fix login bug !h" },
    });

    expect(screen.getByText(/An open task already exists/)).toBeDefined();
  });

  it("warns about similar titles with fuzzy matching", async () => {
    renderWithConfirmation(
      <TaskFormModal
        {...mockProps}
        availableTasks={[
          {
            id: "t1",
            jobId: "J1",
            projectId: "p1",
            title: "Fix login-bug",
            subtitle: "",
            summary: "",
            assignee: "",
            priority: "high",
            status: "c1",
            createdAt: new Date(),
            subtasks: [],
            attachments: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0,
          },
        ]}
      />,
    );

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Fix login bug !h" },
    });

    await waitFor(() => {
      expect(screen.getByText(/Similar:/)).toBeDefined();
    });
  });

  it("hides and restores recent quick-add chips", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    expect(screen.getByText("Recent")).toBeDefined();
    fireEvent.click(screen.getByLabelText("Hide recent quick-add templates"));

    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.getByText("Show Recent")).toBeDefined();

    fireEvent.click(screen.getByText("Show Recent"));
    expect(screen.getByText("Recent")).toBeDefined();
  });

  it("shows batch preview for multi-line quick-add input", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Task one !h\n$Task two !m" },
    });

    expect(screen.getByRole("button", { name: /Batch Preview \(2 Tasks\)/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Batch Preview \(2 Tasks\)/ }));
    expect(screen.getAllByText("Task one").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Task two").length).toBeGreaterThan(0);
  });

  it("suggests metadata from recent quick-add history", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);
    expect(screen.getByText("Suggested")).toBeDefined();
    expect(
      screen.getByText((content) => content.includes("$Title") && content.includes("#work")),
    ).toBeDefined();
  });

  it("focuses AI input when focusAiInput is set", async () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} focusAiInput initialAiInput="$Title !h" />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/) as HTMLTextAreaElement;
    await waitFor(
      () => {
        expect(aiInput.value).toBe("$Title !h");
        expect(document.activeElement).toBe(aiInput);
      },
      { timeout: 3000 },
    );
  });

  it("prefills AI input from command palette query via initialAiInput", () => {
    renderWithConfirmation(
      <TaskFormModal
        {...mockProps}
        focusAiInput
        initialAiInput="$Review PR !h #work"
      />,
    );

    const aiInput = screen.getByPlaceholderText(/Quick-add:/) as HTMLTextAreaElement;
    expect(aiInput.value).toBe("$Review PR !h #work");
    expect(screen.getByText("Fill Form")).toBeDefined();
  });

  it("toggles the collapsible Quick Add Guide", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    expect(screen.queryByText("Syntax Examples")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Quick Add Guide/ }));
    expect(screen.getByText("Syntax Examples")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Quick Add Guide/ }));
    expect(screen.queryByText("Syntax Examples")).toBeNull();
  });

  it("persists Quick Add Guide open state", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    fireEvent.click(screen.getByRole("button", { name: /Quick Add Guide/ }));
    expect(storageService.set).toHaveBeenCalledWith("liquitask-quick-add-guide-open", true);
  });

  it("clears AI input on Escape without closing modal", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/) as HTMLTextAreaElement;
    fireEvent.change(aiInput, { target: { value: "$Task !h" } });
    fireEvent.keyDown(aiInput, { key: "Escape" });

    expect(aiInput.value).toBe("");
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("blocks Create All when a batch line has an empty explicit title", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: '$Task one !h\n$""' },
    });

    const createAllButton = screen.getByText(/Create All/);
    expect(createAllButton).toBeDisabled();
  });

  it("shows batch line status in expanded preview", () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Task one !h\n$Task two !bogus" },
    });

    fireEvent.click(screen.getByText(/Batch Preview/));
    expect(screen.getByText("warning")).toBeDefined();
  });

  it("shows create-all progress when bulk path falls back to onSubmit", async () => {
    renderWithConfirmation(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText(/Quick-add:/);
    fireEvent.change(aiInput, {
      target: { value: "$Task one !h\n$Task two !m\n$Task three !l" },
    });

    fireEvent.click(screen.getByText("Create All (3)"));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(3);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it("resolves workspace file completions from global paths", async () => {
    const searchFiles = vi.fn().mockResolvedValue([
      { path: "src/auth/login.ts", name: "login.ts" },
    ]);

    Object.defineProperty(window, "desktopAPI", {
      value: { workspace: { searchFiles } },
      configurable: true,
    });

    renderWithConfirmation(
      <TaskFormModal
        {...mockProps}
        globalWorkspacePaths={["/workspace/project"]}
      />,
    );

    const aiInput = screen.getByPlaceholderText(/Quick-add:/) as HTMLTextAreaElement;
    fireEvent.change(aiInput, {
      target: { value: "Review @src/auth.ts", selectionStart: 20, selectionEnd: 20 },
    });

    await waitFor(
      () => {
        expect(searchFiles).toHaveBeenCalledWith(
          "src/auth.ts",
          ["/workspace/project"],
        );
      },
      { timeout: 2000 },
    );
  });
});
