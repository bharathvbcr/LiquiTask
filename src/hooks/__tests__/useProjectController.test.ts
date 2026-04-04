import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, ProjectType } from "../../types";
import { useProjectController } from "../useProjectController";

describe("useProjectController", () => {
  const initialProjects: Project[] = [
    { id: "p1", name: "Project 1", type: "default", icon: "folder", order: 0 },
    { id: "p2", name: "Project 2", type: "custom", icon: "folder", order: 1 },
  ];
  const initialProjectTypes: ProjectType[] = [
    { id: "default", label: "Default", color: "blue" },
  ];
  const mockAddToast = vi.fn();
  const mockConfirm = vi.fn();

  const props = {
    initialProjects,
    initialProjectTypes,
    addToast: mockAddToast,
    confirm: mockConfirm,
  };

  it("should initialize with initial values", () => {
    const { result } = renderHook(() => useProjectController(props));
    expect(result.current.projects).toEqual(initialProjects);
    expect(result.current.projectTypes).toEqual(initialProjectTypes);
  });

  it("should handle handleCreateProject with string name", () => {
    const { result } = renderHook(() => useProjectController(props));
    let newProject: Project;
    act(() => {
      newProject = result.current.handleCreateProject("New Project", "rocket", "p1");
    });
    expect(result.current.projects).toHaveLength(3);
    expect(result.current.projects.find(p => p.name === "New Project")).toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith('Workspace "New Project" created', "success");
  });

  it("should handle handleCreateProject with project object", () => {
    const { result } = renderHook(() => useProjectController(props));
    act(() => {
      result.current.handleCreateProject({ name: "Obj Project", icon: "star" });
    });
    expect(result.current.projects).toHaveLength(3);
    expect(result.current.projects.find(p => p.name === "Obj Project")).toBeDefined();
  });

  it("should handle handleDeleteProject", async () => {
    mockConfirm.mockResolvedValue(true);
    const mockSetActiveProjectId = vi.fn();
    const mockSetTasks = vi.fn();
    const { result } = renderHook(() => useProjectController(props));

    await act(async () => {
      const deleted = await result.current.handleDeleteProject("p2", "p2", mockSetActiveProjectId, mockSetTasks);
      expect(deleted).toBe(true);
    });

    expect(result.current.projects).toHaveLength(1);
    expect(mockSetActiveProjectId).toHaveBeenCalledWith("p1");
    expect(mockAddToast).toHaveBeenCalledWith("Workspace deleted", "info");
  });

  it("should not delete project with sub-projects", async () => {
    const { result } = renderHook(() => useProjectController({
      ...props,
      initialProjects: [
        { id: "parent", name: "Parent", type: "custom" },
        { id: "child", name: "Child", type: "custom", parentId: "parent" }
      ]
    }));

    await act(async () => {
      const deleted = await result.current.handleDeleteProject("parent", "parent", vi.fn(), vi.fn());
      expect(deleted).toBe(false);
    });

    expect(mockAddToast).toHaveBeenCalledWith("Cannot delete a project that has sub-projects.", "error");
  });

  it("should handle handleTogglePin", () => {
    const { result } = renderHook(() => useProjectController(props));
    act(() => {
      result.current.handleTogglePin("p1");
    });
    expect(result.current.projects[0].pinned).toBe(true);
    act(() => {
      result.current.handleTogglePin("p1");
    });
    expect(result.current.projects[0].pinned).toBe(false);
  });

  it("should handle handleMoveProject", () => {
    const { result } = renderHook(() => useProjectController(props));
    act(() => {
      result.current.handleMoveProject("p1", "down");
    });
    // p1 order should increase, p2 order should decrease
    const p1 = result.current.projects.find(p => p.id === "p1");
    const p2 = result.current.projects.find(p => p.id === "p2");
    expect(p1?.order).toBe(1);
    expect(p2?.order).toBe(0);
  });

  it("should handle handleEditProject", () => {
    const { result } = renderHook(() => useProjectController(props));
    act(() => {
      result.current.handleEditProject("p1", "Renamed", "zap");
    });
    const p1 = result.current.projects.find(p => p.id === "p1");
    expect(p1?.name).toBe("Renamed");
    expect(p1?.icon).toBe("zap");
    expect(mockAddToast).toHaveBeenCalledWith("Workspace updated", "success");
  });
});
