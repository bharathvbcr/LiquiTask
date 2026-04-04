import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
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
    fireEvent.submit(screen.getByRole("form"));
    expect(defaultProps.onSendMessage).toHaveBeenCalledWith("Hello");
  });

  it("renders messages correctly", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "Hello", timestamp: new Date() },
      { id: "2", role: "assistant" as const, content: "Hi there!", timestamp: new Date() },
    ];
    render(<TaskAssistantSidebar {...defaultProps} messages={messages} />);
    expect(screen.getByText("Hello")).toBeDefined();
    expect(screen.getByText("Hi there!")).toBeDefined();
  });
});
