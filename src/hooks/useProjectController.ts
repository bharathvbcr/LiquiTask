import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import type { Project, ProjectType, Task, ToastType } from "../../types";
import type { ConfirmationOptions } from "../contexts/ConfirmationContext";

interface ProjectControllerProps {
  initialProjects: Project[];
  initialProjectTypes: ProjectType[];
  addToast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
}

export const useProjectController = ({
  initialProjects,
  initialProjectTypes,
  addToast,
  confirm,
}: ProjectControllerProps) => {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>(initialProjectTypes);

  const handleCreateProject = useCallback(
    (name: string, icon: string, parentId?: string) => {
      const siblings = projects.filter((p) => p.parentId === parentId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((p) => p.order || 0)) : -1;

      const newProject: Project = {
        id: `p-${Date.now()}`,
        name,
        type: "custom",
        icon,
        parentId,
        order: maxOrder + 1,
      };
      setProjects((prev) => [...prev, newProject]);
      addToast(`Workspace "${name}" created`, "success");
      return newProject;
    },
    [projects, addToast],
  );

  const handleDeleteProject = useCallback(
    async (
      id: string,
      activeProjectId: string,
      setActiveProjectId: (id: string) => void,
      setTasks: Dispatch<SetStateAction<Task[]>>,
    ) => {
      const hasChildren = projects.some((p) => p.parentId === id);
      if (hasChildren) {
        addToast("Cannot delete a project that has sub-projects.", "error");
        return false;
      }

      const confirmed = await confirm({
        title: "Delete Workspace",
        message: "Delete this workspace? All associated tasks will be removed.",
        confirmText: "Delete Workspace",
        variant: "danger",
      });

      if (confirmed) {
        const newProjects = projects.filter((p) => p.id !== id);
        setProjects(newProjects);
        setTasks((prev) => prev.filter((t) => t.projectId !== id));
        if (activeProjectId === id) {
          setActiveProjectId(newProjects.length > 0 ? newProjects[0].id : "");
        }
        addToast("Workspace deleted", "info");
        return true;
      }
      return false;
    },
    [projects, addToast, confirm],
  );

  const handleTogglePin = useCallback((projectId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === projectId) return { ...p, pinned: !p.pinned };
        return p;
      }),
    );
  }, []);

  const handleMoveProject = useCallback((projectId: string, direction: "up" | "down") => {
    setProjects((prev) => {
      const targetProject = prev.find((p) => p.id === projectId);
      if (!targetProject) return prev;

      const isPinned = !!targetProject.pinned;
      const parentId = targetProject.parentId;

      const siblings = prev.filter((p) => p.parentId === parentId && !!p.pinned === isPinned);
      siblings.sort((a, b) => (a.order || 0) - (b.order || 0));

      const currentIndex = siblings.findIndex((p) => p.id === projectId);
      if (currentIndex === -1) return prev;

      const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (swapIndex < 0 || swapIndex >= siblings.length) return prev;

      const reordered = [...siblings];
      [reordered[currentIndex], reordered[swapIndex]] = [
        reordered[swapIndex],
        reordered[currentIndex],
      ];

      const orderMap = new Map<string, number>();
      reordered.forEach((p, idx) => {
        orderMap.set(p.id, idx);
      });

      return prev.map((p) => {
        if (orderMap.has(p.id)) {
          return { ...p, order: orderMap.get(p.id) };
        }
        return p;
      });
    });
  }, []);

  const handleEditProject = useCallback(
    (projectId: string, newName: string, newIcon: string) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id === projectId) return { ...p, name: newName, icon: newIcon };
          return p;
        }),
      );
      addToast("Workspace updated", "success");
    },
    [addToast],
  );

  return {
    projects,
    setProjects,
    projectTypes,
    setProjectTypes,
    handleCreateProject,
    handleDeleteProject,
    handleTogglePin,
    handleMoveProject,
    handleEditProject,
  };
};
