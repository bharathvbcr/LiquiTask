import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskAssistantSidebar } from "../TaskAssistantSidebar";

describe("TaskAssistantSidebar Component", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    messages: [],
    onSendMessage: vi.fn(),
    isLoading: false,
    onClearChat: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("renders the sidebar when open", () => {
    render(<TaskAssistantSidebar {...defaultProps} />);
    expect(screen.getByText("AI Assistant")).toBeDefined();
  });

  it("calls onClose when the close button is clicked", () => {
    render(<TaskAssistantSidebar {...defaultProps} />);
    const closeBtn = screen.getByLabelText("Close assistant");
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("calls onSendMessage when input is submitted", async () => {
    render(<TaskAssistantSidebar {...defaultProps} />);
    const input = screen.getByPlaceholderText("Ask anything...");
    fireEvent.change(input, { target: { value: "Hello" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith("Hello");
  });

  it("filters out function role messages", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "Search", timestamp: new Date() },
      {
        id: "2",
        role: "function" as const,
        content: "Result",
        timestamp: new Date(),
        toolResults: [{ name: "search", result: [] }],
      },
    ];
    render(<TaskAssistantSidebar {...defaultProps} messages={messages} />);
    expect(screen.getByText("Search")).toBeDefined();
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("renders tool call indicators in assistant messages", () => {
    const messages = [
      {
        id: "1",
        role: "assistant" as const,
        content: "",
        timestamp: new Date(),
        toolCalls: [{ name: "create_task", args: {} }],
      },
    ];
    render(<TaskAssistantSidebar {...defaultProps} messages={messages} />);
    expect(screen.getByText("create_task()")).toBeDefined();
  });

  it("shows searching status", () => {
    render(<TaskAssistantSidebar {...defaultProps} isSearching={true} />);
    expect(screen.getByText("Analyzing workspace context...")).toBeDefined();
  });

  it("shows active tool usage", () => {
    render(<TaskAssistantSidebar {...defaultProps} isLoading={true} activeTool="update_task" />);
    expect(screen.getByText(/Executing update task/i)).toBeDefined();
  });

  it("renders suggested replies for the last message", () => {
    const messages = [
      { id: "1", role: "assistant" as const, content: "Done", timestamp: new Date() },
    ];
    render(<TaskAssistantSidebar {...defaultProps} messages={messages} />);
    expect(screen.getByText("Tell me more")).toBeDefined();
    expect(screen.getByText("What's next?")).toBeDefined();
  });
});
