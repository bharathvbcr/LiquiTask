import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditProjectModal } from "../EditProjectModal";

describe("EditProjectModal", () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();
  const mockProject = { id: "p1", name: "Original Name", type: "folder" };
  const mockProjectTypes = [{ id: "folder", label: "Folder", icon: "folder" }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with project data", () => {
    render(
      <EditProjectModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        project={mockProject}
        projectTypes={mockProjectTypes}
      />,
    );
    expect(screen.getByDisplayValue("Original Name")).toBeDefined();
  });

  it("handles name change and save", () => {
    render(
      <EditProjectModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        project={mockProject}
        projectTypes={mockProjectTypes}
      />,
    );

    const input = screen.getByDisplayValue("Original Name");
    fireEvent.change(input, { target: { value: "Updated Name" } });

    const saveButton = screen.getByText("Save Changes");
    fireEvent.click(saveButton);

    expect(mockOnSave).toHaveBeenCalledWith("p1", "Updated Name", "folder");
  });

  it("calls onClose when cancel is clicked", () => {
    render(
      <EditProjectModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        project={mockProject}
        projectTypes={mockProjectTypes}
      />,
    );

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);
    expect(mockOnClose).toHaveBeenCalled();
  });
});
