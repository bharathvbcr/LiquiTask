import { ChevronDown, ChevronRight, Folder, LayoutDashboard, Settings, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { Project } from "../../types";

type NavigationView = "project" | "dashboard" | "gantt";

interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenSettings: () => void;
  currentView: NavigationView;
  onChangeView: (view: NavigationView) => void;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  isOpen,
  onClose,
  projects,
  activeProjectId,
  onSelectProject,
  onOpenSettings,
  currentView,
  onChangeView,
}) => {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(projects.map((p) => p.id)),
  );

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    setExpandedProjects(new Set(projects.map((p) => p.id)));
  }, [projects]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleSelectProject = (id: string) => {
    onSelectProject(id);
    onChangeView("project");
    onClose();
  };

  const handleNavigate = (view: NavigationView) => {
    onChangeView(view);
    onClose();
  };

  const toggleProjectExpand = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const rootProjects = projects
    .filter((p) => !p.parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div
        onClick={handleBackdropClick}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Drawer Panel */}
      <div
        className={`absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-[#0a0a0a] border-r border-white/10 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h1 className="text-xl font-bold text-white tracking-tight text-glow">
              Liqui<span className="text-red-500 font-light">Task</span>
            </h1>
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close navigation"
            >
              <X size={20} />
            </button>
          </div>

          {/* Navigation Items */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 space-y-1">
            {/* Dashboard */}
            <NavButton
              icon={<LayoutDashboard size={18} />}
              label="Dashboard"
              isActive={currentView === "dashboard"}
              onClick={() => handleNavigate("dashboard")}
            />

            {/* Projects Section */}
            <div className="mt-4">
              <div className="flex items-center gap-2 px-3 mb-2">
                <Folder size={14} className="text-slate-300" />
                <h2 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                  Projects
                </h2>
              </div>

              <div className="space-y-0.5">
                {rootProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    allProjects={projects}
                    activeProjectId={activeProjectId}
                    currentView={currentView}
                    expandedProjects={expandedProjects}
                    onSelect={handleSelectProject}
                    onToggleExpand={toggleProjectExpand}
                    depth={0}
                  />
                ))}

                {rootProjects.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">
                    No projects yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer - Settings */}
          <div className="border-t border-white/10 bg-[#050000]/30 p-4">
            <button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 min-h-[44px]"
            >
              <Settings size={18} className="shrink-0" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ icon, label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`relative w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 min-h-[44px] ${
      isActive
        ? "bg-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
        : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
    }`}
  >
    {isActive && (
      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-red-500 rounded-r-full shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
    )}
    <span className={`shrink-0 ${isActive ? "text-red-400" : ""}`}>{icon}</span>
    <span>{label}</span>
  </button>
);

interface ProjectItemProps {
  project: Project;
  allProjects: Project[];
  activeProjectId: string;
  currentView: NavigationView;
  expandedProjects: Set<string>;
  onSelect: (id: string) => void;
  onToggleExpand: (e: React.MouseEvent, projectId: string) => void;
  depth: number;
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  allProjects,
  activeProjectId,
  currentView,
  expandedProjects,
  onSelect,
  onToggleExpand,
  depth,
}) => {
  const children = allProjects
    .filter((p) => p.parentId === project.id)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const hasChildren = children.length > 0;
  const isExpanded = expandedProjects.has(project.id);
  const isActive = project.id === activeProjectId && currentView === "project";
  const indent = depth * 12;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect(project.id)}
        className={`relative w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 min-h-[44px] ${
          isActive
            ? "bg-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
        }`}
        style={{ marginLeft: `${indent}px` }}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-red-500 rounded-r-full shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
        )}

        {hasChildren ? (
          <div
            onClick={(e) => onToggleExpand(e, project.id)}
            className="p-1 hover:bg-white/10 rounded-lg transition-colors shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            {isExpanded ? (
              <ChevronDown size={12} className="text-slate-400" />
            ) : (
              <ChevronRight size={12} className="text-slate-400" />
            )}
          </div>
        ) : (
          <div className="w-7 shrink-0" />
        )}

        <Folder size={16} className={`shrink-0 ${isActive ? "text-red-400" : "text-slate-400"}`} />
        <span className="flex-1 text-left truncate">{project.name}</span>
      </button>

      {/* Sub-projects */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col gap-0.5">
          {children.map((child) => (
            <ProjectItem
              key={child.id}
              project={child}
              allProjects={allProjects}
              activeProjectId={activeProjectId}
              currentView={currentView}
              expandedProjects={expandedProjects}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
