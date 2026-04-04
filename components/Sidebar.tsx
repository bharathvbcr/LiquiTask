import {
  ArrowDown,
  ArrowUp,
  Box,
  Briefcase,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code,
  CornerDownRight,
  Cpu,
  Database,
  Edit2,
  Folder,
  FolderPlus,
  Globe,
  LayoutDashboard,
  Megaphone,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Shield,
  Smartphone,
  Star,
  Trash2,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import logo from "../src/assets/logo.png";
import type { Project, ProjectType } from "../types";

const EditProjectModal = React.lazy(() =>
  import("./EditProjectModal").then((module) => ({
    default: module.EditProjectModal,
  })),
);

interface SidebarProps {
  projects: Project[];
  activeProjectId: string;
  projectTypes: ProjectType[];
  isCollapsed: boolean;
  toggleSidebar: () => void;
  onSelectProject: (id: string) => void;
  onAddProject: (parentId?: string) => void;
  onDeleteProject: (id: string) => void;
  onOpenSettings: () => void;
  currentView: "project" | "dashboard" | "gantt";
  onChangeView: (view: "project" | "dashboard" | "gantt") => void;
  onTogglePin: (id: string) => void;
  onEditProject: (id: string, newName: string, newIcon: string) => void;
  onMoveProject?: (id: string, direction: "up" | "down") => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  projects,
  activeProjectId,
  projectTypes,
  isCollapsed,
  toggleSidebar,
  onSelectProject,
  onAddProject,
  onDeleteProject,
  onOpenSettings,
  currentView,
  onChangeView,
  onTogglePin,
  onMoveProject,
  onEditProject,
}) => {
  const collapsedOffset = -240;
  const [projectSearch, setProjectSearch] = useState("");
  const [isRailHovered, setIsRailHovered] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set((projects || []).map((p) => p.id)),
  );
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [hoveredProject, setHoveredProject] = useState<{
    project: Project;
    top: number;
  } | null>(null);
  const [hoveredItem, setHoveredItem] = useState<{
    label: string;
    top: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const mouseDownRef = useRef<boolean>(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    const handleMouseUp = () => {
      mouseDownRef.current = false;
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const isHoverExpanded = isCollapsed && isRailHovered;
  const isEffectivelyCollapsed = isCollapsed && !isHoverExpanded;

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const toggleProjectExpand = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    const newSet = new Set(expandedProjects);
    if (newSet.has(projectId)) {
      newSet.delete(projectId);
    } else {
      newSet.add(projectId);
    }
    setExpandedProjects(newSet);
  };

  const getIcon = (iconKey: string) => {
    switch (iconKey) {
      case "code":
        return <Code size={18} />;
      case "megaphone":
        return <Megaphone size={18} />;
      case "smartphone":
        return <Smartphone size={18} />;
      case "box":
        return <Box size={18} />;
      case "folder":
        return <Folder size={18} />;
      case "globe":
        return <Globe size={18} />;
      case "cpu":
        return <Cpu size={18} />;
      case "shield":
        return <Shield size={18} />;
      case "wrench":
        return <Wrench size={18} />;
      case "zap":
        return <Zap size={18} />;
      case "database":
        return <Database size={18} />;
      case "star":
        return <Star size={18} />;
      case "users":
        return <Users size={18} />;
      case "settings":
        return <Settings size={18} />;
      case "calendar":
        return <Calendar size={18} />;
      case "server":
      case "layout":
      case "pen-tool":
      case "book-open":
      case "home":
        return <Folder size={18} />;
      case "truck":
      case "shopping-cart":
        return <Box size={18} />;
      case "target":
      case "trending-up":
      case "lightbulb":
        return <Zap size={18} />;
      case "video":
      case "camera":
      case "music":
      case "anchor":
      case "coffee":
      case "rocket":
      case "heart":
      case "flag":
      case "award":
      case "gift":
        return <Star size={18} />;
      case "message-square":
        return <Users size={18} />;
      default:
        return <Briefcase size={18} />;
    }
  };

  const getProjectIcon = (project: Project) => {
    // Check direct icon first, then fall back to type-based icon
    if (project.icon) {
      return getIcon(project.icon);
    }
    const type = projectTypes.find((t) => t.id === project.type);
    return getIcon(type?.icon || "folder");
  };

  const ProjectItem: React.FC<{ project: Project; depth: number }> = ({ project, depth }) => {
    const children = projects
      .filter((p) => p.parentId === project.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const hasVisibleChildren = children.length > 0;
    const isExpanded = expandedProjects.has(project.id) || projectSearch.length > 0;
    const isActive = project.id === activeProjectId && currentView === "project";
    const indent = depth * 12;
    const isMenuOpen = activeMenuId === project.id;
    const expandedContentClass = isEffectivelyCollapsed
      ? "max-w-0 opacity-0 -translate-x-2 pointer-events-none"
      : "max-w-[220px] opacity-100 translate-x-0";

    return (
      <div className="flex flex-col gap-0.5">
        {/* Dynamic indentation requires inline style for nested project hierarchy */}
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <div
          onMouseDown={() => {
            mouseDownRef.current = true;
          }}
          onMouseUp={() => {
            mouseDownRef.current = false;
          }}
          onClick={() => {
            onSelectProject(project.id);
            onChangeView("project");
            setIsRailHovered(false);
            setHoveredProject(null);
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
              hoverTimeoutRef.current = null;
            }
          }}
          onMouseEnter={(e) => {
            // Clear any pending timeout
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
              hoverTimeoutRef.current = null;
            }
            if (isEffectivelyCollapsed) {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoveredProject({ project, top: rect.top + rect.height / 2 });
            }
          }}
          onMouseLeave={() => {
            // Don't clear hover state if mouse is down (during click)
            if (mouseDownRef.current) {
              return;
            }
            // Add small delay to prevent flicker when moving between items
            hoverTimeoutRef.current = setTimeout(() => {
              setHoveredProject(null);
            }, 150);
          }}
          className={`
                group relative px-2.5 py-2.5 rounded-xl cursor-pointer transition-[background-color,color,transform] duration-200
                flex items-center overflow-visible
                ${isEffectivelyCollapsed ? "justify-center" : "justify-between"}
                ${isActive ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "text-slate-400 hover:text-slate-100 hover:bg-white/5"}
                ${isEffectivelyCollapsed ? "active:bg-white/10" : ""}
              `}
          style={
            isEffectivelyCollapsed
              ? undefined
              : ({
                  "--indent": `${indent}px`,
                  marginLeft: "var(--indent)",
                } as React.CSSProperties & { "--indent": string })
          }
        >
          {/* Active Indicator Line */}
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-red-500 rounded-r-full shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
          )}

          <div className="flex items-center gap-3 relative z-10 w-full overflow-hidden">
            <div
              className={`flex items-center gap-3 min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${expandedContentClass}`}
            >
              <div className="shrink-0">
                {depth > 0 && <CornerDownRight size={14} className="text-slate-400" />}
              </div>

              <div className="shrink-0">
                {hasVisibleChildren && (
                  <div
                    onClick={(e) => toggleProjectExpand(e, project.id)}
                    className="hover:bg-white/10 rounded p-0.5 -ml-1 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </div>
                )}
              </div>
            </div>

            <span
              className={`transition-colors shrink-0 duration-300 ${isActive ? "text-red-400" : "group-hover:text-red-400/80"}`}
            >
              {getProjectIcon(project)}
            </span>

            <span
              className={`font-medium text-sm truncate transition-[max-width,opacity,transform] duration-300 ease-out ${expandedContentClass} flex-1`}
            >
              {project.name}
            </span>

            {/* Pinned Icon */}
            <Pin
              size={10}
              className={`text-red-500 fill-red-500 rotate-45 shrink-0 transition-[opacity,transform,max-width] duration-300 ease-out ${project.pinned ? expandedContentClass : "max-w-0 opacity-0 -translate-x-2 pointer-events-none"}`}
            />
          </div>

          {/* Action Button (Visible on Hover) */}
          <div
            className={`absolute right-2 z-20 transition-[opacity,transform,max-width] duration-300 ease-out ${expandedContentClass} ${isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuId(isMenuOpen ? null : project.id);
              }}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
              aria-label={`More options for ${project.name}`}
              title={`More options for ${project.name}`}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>

            {/* Popover Menu */}
            {isMenuOpen && (
              <div
                ref={menuRef}
                className="absolute top-8 right-0 w-48 bg-[#0a0e17] border border-white/10 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
              >
                <div className="p-1 flex flex-col gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddProject(project.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <FolderPlus size={14} className="text-emerald-400" /> Add Sub-project
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingProject(project);
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Edit2 size={14} className="text-blue-400" /> Edit
                  </button>
                  <div className="h-px bg-white/5 my-0.5" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveProject(project.id, "up");
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ArrowUp size={14} /> Move Up
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveProject(project.id, "down");
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ArrowDown size={14} /> Move Down
                  </button>
                  <div className="h-px bg-white/5 my-0.5" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(project.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    {project.pinned ? (
                      <>
                        <PinOff size={14} /> Unpin
                      </>
                    ) : (
                      <>
                        <Pin size={14} /> Pin
                      </>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteProject(project.id);
                      setActiveMenuId(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Nested Children */}
        {hasVisibleChildren && isExpanded && (
          <div className="flex flex-col gap-0.5">
            {children.map((child) => (
              <ProjectItem key={child.id} project={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const displayProjects = useMemo(() => {
    if (!projectSearch) return projects.filter((p) => !p.parentId && !p.pinned);
    return projects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase()));
  }, [projects, projectSearch]);

  const pinnedProjects = projects
    .filter((p) => p.pinned)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <aside
      onMouseLeave={() => {
        // Don't clear hover state if mouse is down (during click)
        if (!mouseDownRef.current) {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
          }
          setHoveredProject(null);
          setHoveredItem(null);
          setIsRailHovered(false);
        }
      }}
      onMouseEnter={() => {
        if (isCollapsed) {
          setIsRailHovered(true);
        }
      }}
      className={`
            pointer-events-none fixed left-4 top-14 z-50 hidden h-[calc(100vh-4.5rem)] w-20 overflow-visible md:block
        `}
    >
      <div
        className="pointer-events-auto flex h-full w-80 flex-col overflow-hidden rounded-[28px] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.8)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform liquid-glass border border-white/10"
        style={{
          transform: `translateX(${isEffectivelyCollapsed ? collapsedOffset : 0}px)`,
          paddingLeft: isEffectivelyCollapsed ? `${Math.abs(collapsedOffset)}px` : "0px",
        }}
      >
        {/* Header Logo */}
        <div
          className={`p-6 pb-2 flex items-center ${isEffectivelyCollapsed ? "justify-center" : "justify-between"} transition-[padding] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center shrink-0 relative group">
              <img
                src={logo}
                alt="Logo"
                className="w-8 h-8 object-contain relative z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]"
              />
            </div>
            <div
              className={`overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${isEffectivelyCollapsed ? "max-w-0 opacity-0 -translate-x-2" : "max-w-[160px] opacity-100 translate-x-0"}`}
            >
              <h1 className="text-xl font-bold text-white tracking-tight whitespace-nowrap text-glow">
                Liqui<span className="text-red-500 font-light">Task</span>
              </h1>
            </div>
          </div>
        </div>

        {/* Collapse Toggle */}
        <div className="flex justify-end px-4 mb-4">
          <button
            onClick={toggleSidebar}
            className="p-2.5 text-slate-300 hover:text-white rounded-xl hover:bg-white/5 transition-colors duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Scrollable Area */}
        <div
          className={`px-3 flex-1 custom-scrollbar space-y-6 pb-4 ${isEffectivelyCollapsed ? "overflow-visible" : "overflow-y-auto"}`}
        >
          {/* Quick Navigation */}
          <div className="space-y-1 mb-4">
            <div
              onClick={() => onChangeView("dashboard")}
              title="Open Dashboard"
              aria-label="Open Dashboard"
              onMouseEnter={(e) => {
                if (isEffectivelyCollapsed) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredItem({
                    label: "Dashboard",
                    top: rect.top + rect.height / 2,
                  });
                }
              }}
              onMouseLeave={() => setHoveredItem(null)}
              className={`
              group px-3 py-2.5 rounded-xl cursor-pointer transition-[background-color,color,transform] duration-300
              flex items-center relative overflow-hidden border border-transparent
              ${isEffectivelyCollapsed ? "justify-center" : ""}
              ${currentView === "dashboard" ? "bg-red-500/10 border-red-500/20 text-red-50" : "text-slate-400 hover:text-slate-100 hover:bg-white/5"}
            `}
            >
              <div className="relative z-10 flex items-center gap-3">
                <LayoutDashboard
                  size={18}
                  className={`shrink-0 transition-colors ${currentView === "dashboard" ? "text-red-400 drop-shadow-md" : "group-hover:text-red-400"}`}
                />
                {!isEffectivelyCollapsed && <span className="font-medium text-sm">Dashboard</span>}
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div
            className={`px-1 relative group overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${isEffectivelyCollapsed ? "max-h-0 opacity-0 -translate-y-2 pointer-events-none" : "max-h-16 opacity-100 translate-y-0"}`}
          >
            <Search
              size={14}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-red-400 transition-colors"
            />
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search workspaces..."
              className="w-full bg-black/20 border border-white/5 rounded-xl py-2.5 pl-9 pr-3 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-red-500/50 focus:border-red-500/30 hover:bg-black/40 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
            />
          </div>

          {/* Pinned Section */}
          {pinnedProjects.length > 0 && !projectSearch && (
            <div className="space-y-1">
              <div
                className={`flex items-center gap-2 mb-2 px-2 text-slate-300 overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${isEffectivelyCollapsed ? "max-h-0 opacity-0 -translate-y-2 pointer-events-none" : "max-h-8 opacity-100 translate-y-0"}`}
              >
                <Pin size={10} />
                <h2 className="text-[10px] font-bold uppercase tracking-widest">Pinned</h2>
              </div>
              {pinnedProjects.map((project) => (
                <ProjectItem key={project.id} project={project} depth={0} />
              ))}
              <div
                className={`h-px bg-white/5 mx-2 mt-4 transition-[opacity,max-height,margin] duration-300 ease-out ${isEffectivelyCollapsed ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-px"}`}
              ></div>
            </div>
          )}

          {/* Workspaces Section */}
          <div className="space-y-1">
            <div
              className={`flex items-center justify-between mb-2 px-2 overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out ${isEffectivelyCollapsed ? "max-h-0 opacity-0 -translate-y-2 pointer-events-none" : "max-h-8 opacity-100 translate-y-0"}`}
            >
              <h2 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                Workspaces
              </h2>
              <button
                onClick={() => onAddProject()}
                className="p-1 hover:bg-white/10 rounded text-slate-300 hover:text-red-400 transition-colors"
                title="New Workspace"
              >
                <Plus size={14} />
              </button>
            </div>

            {isEffectivelyCollapsed && (
              <button
                onClick={() => onAddProject()}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredItem({
                    label: "New Workspace",
                    top: rect.top + rect.height / 2,
                  });
                }}
                onMouseLeave={() => setHoveredItem(null)}
                className="w-full p-3 mb-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors flex justify-center"
                aria-label="New Workspace"
                title="New Workspace"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            )}

            {/* List Projects */}
            {displayProjects.map((project) => (
              <ProjectItem key={project.id} project={project} depth={projectSearch ? 0 : 0} />
            ))}

            {displayProjects.length === 0 && !isCollapsed && (
              <div className="px-4 py-6 text-center text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">
                {projectSearch ? "No matching workspaces." : "No workspaces yet."}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto border-t border-white/5 bg-white/[0.02] p-4">
          <button
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
            onMouseEnter={(e) => {
              if (isEffectivelyCollapsed) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredItem({
                  label: "Settings",
                  top: rect.top + rect.height / 2,
                });
              }
            }}
            onMouseLeave={() => setHoveredItem(null)}
            className={`flex items-center gap-3 w-full rounded-xl hover:bg-white/5 cursor-pointer text-slate-400 hover:text-slate-100 transition-[background-color,color] border border-transparent hover:border-white/5 ${isEffectivelyCollapsed ? "justify-center px-2 py-3.5" : "px-3 py-3"}`}
          >
            <Settings size={isEffectivelyCollapsed ? 26 : 22} />
            <span
              className={`text-sm font-medium overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out ${isEffectivelyCollapsed ? "max-w-0 opacity-0 -translate-x-2" : "max-w-[120px] opacity-100 translate-x-0"}`}
            >
              Settings
            </span>
          </button>
        </div>

        {/* Edit Project Modal */}
        <Suspense fallback={null}>
          <EditProjectModal
            isOpen={editingProject !== null}
            onClose={() => setEditingProject(null)}
            onSave={onEditProject}
            project={editingProject}
          />
        </Suspense>
      </div>

      {/* Hover Tooltip for Collapsed Sidebar - rendered outside scroll container */}
      {/* Dynamic positioning requires inline style for tooltip placement */}
      {/* eslint-disable-next-line react/forbid-dom-props */}
      {isEffectivelyCollapsed && hoveredProject && (
        <div
          className="fixed left-24 px-3 py-1.5 bg-[#1a1a2e] border border-white/10 rounded-lg shadow-2xl pointer-events-none whitespace-nowrap z-[9999] animate-in fade-in duration-150"
          style={{ top: hoveredProject.top, transform: "translateY(-50%)" }}
        >
          <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-[#1a1a2e] border-l border-b border-white/10 rotate-45"></div>
          <span className="text-sm font-medium text-white">{hoveredProject.project.name}</span>
          {hoveredProject.project.pinned && (
            <Pin size={10} className="inline-block ml-1.5 text-red-500 fill-red-500 rotate-45" />
          )}
        </div>
      )}

      {/* Hover Tooltip for other icons (Dashboard, Settings, Add) */}
      {/* Dynamic positioning requires inline style for tooltip placement */}
      {/* eslint-disable-next-line react/forbid-dom-props */}
      {isEffectivelyCollapsed && hoveredItem && (
        <div
          className="fixed left-24 px-3 py-1.5 bg-[#1a1a2e] border border-white/10 rounded-lg shadow-2xl pointer-events-none whitespace-nowrap z-[9999] animate-in fade-in duration-150"
          style={{ top: hoveredItem.top, transform: "translateY(-50%)" }}
        >
          <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-[#1a1a2e] border-l border-b border-white/10 rotate-45"></div>
          <span className="text-sm font-medium text-white">{hoveredItem.label}</span>
        </div>
      )}
    </aside>
  );
};
