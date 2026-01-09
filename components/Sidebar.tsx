import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Briefcase, Code, Megaphone, Smartphone, Box, Settings, Plus, Trash2, Folder, Globe, Cpu, Shield,
  ChevronLeft, ChevronRight, LayoutDashboard, CornerDownRight, Wrench, Zap, Truck, Database, Server,
  Layout, PenTool, Music, Video, Camera, Anchor, Coffee, Pin, PinOff, ArrowUp, ArrowDown, Search,
  FolderPlus, ChevronDown, MoreHorizontal
} from 'lucide-react';
import { Project, ProjectType } from '../types';
import logo from '../src/assets/logo.png';

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
  currentView: 'project' | 'dashboard';
  onChangeView: (view: 'project' | 'dashboard') => void;
  onTogglePin: (id: string) => void;
  onMoveProject: (id: string, direction: 'up' | 'down') => void;
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
  onMoveProject
}) => {
  const [projectSearch, setProjectSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set((projects || []).map(p => p.id)));
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      case 'code': return <Code size={18} />;
      case 'megaphone': return <Megaphone size={18} />;
      case 'smartphone': return <Smartphone size={18} />;
      case 'box': return <Box size={18} />;
      case 'folder': return <Folder size={18} />;
      case 'globe': return <Globe size={18} />;
      case 'cpu': return <Cpu size={18} />;
      case 'shield': return <Shield size={18} />;
      case 'wrench': return <Wrench size={18} />;
      case 'zap': return <Zap size={18} />;
      case 'truck': return <Truck size={18} />;
      case 'database': return <Database size={18} />;
      case 'server': return <Server size={18} />;
      case 'layout': return <Layout size={18} />;
      case 'pen-tool': return <PenTool size={18} />;
      case 'music': return <Music size={18} />;
      case 'video': return <Video size={18} />;
      case 'camera': return <Camera size={18} />;
      case 'anchor': return <Anchor size={18} />;
      case 'coffee': return <Coffee size={18} />;
      default: return <Briefcase size={18} />;
    }
  };

  const getProjectIcon = (typeId: string) => {
    const type = projectTypes.find(t => t.id === typeId);
    return getIcon(type?.icon || 'folder');
  };

  const ProjectItem: React.FC<{ project: Project, depth: number }> = ({ project, depth }) => {
    const children = projects
      .filter(p => p.parentId === project.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const hasVisibleChildren = children.length > 0;
    const isExpanded = expandedProjects.has(project.id) || projectSearch.length > 0;
    const isActive = project.id === activeProjectId && currentView === 'project';
    const indent = isCollapsed ? 0 : depth * 12;
    const isMenuOpen = activeMenuId === project.id;

    return (
      <div className="flex flex-col gap-1">
        <div
          onClick={() => {
            onSelectProject(project.id);
            onChangeView('project');
          }}
          className={`
                group relative px-2.5 py-3 rounded-xl cursor-pointer transition-all duration-200
                flex items-center overflow-visible
                ${isCollapsed ? 'justify-center' : 'justify-between'}
                ${isActive ? 'bg-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}
              `}
          style={{ marginLeft: isCollapsed ? 0 : `${indent}px` }}
          title={isCollapsed ? project.name : undefined}
        >
          {/* Active Indicator Line */}
          {isActive && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-red-500 rounded-r-full shadow-[0_0_10px_rgba(239,68,68,0.5)]"></div>
          )}

          <div className="flex items-center gap-3 relative z-10 w-full overflow-hidden">
            {depth > 0 && !isCollapsed && (
              <CornerDownRight size={14} className="text-slate-700 shrink-0" />
            )}

            {hasVisibleChildren && !isCollapsed && (
              <div
                onClick={(e) => toggleProjectExpand(e, project.id)}
                className="hover:bg-white/10 rounded p-0.5 -ml-1 transition-colors"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </div>
            )}

            <span className={`transition-colors shrink-0 duration-300 ${isActive ? 'text-red-400' : 'group-hover:text-red-400/80'}`}>
              {getProjectIcon(project.type)}
            </span>

            {!isCollapsed && (
              <span className="font-medium text-sm truncate transition-all duration-300 flex-1">
                {project.name}
              </span>
            )}

            {/* Pinned Icon */}
            {project.pinned && !isCollapsed && (
              <Pin size={10} className="text-red-500 fill-red-500 rotate-45 shrink-0" />
            )}
          </div>

          {/* Action Button (Visible on Hover) */}
          {!isCollapsed && (
            <div className={`absolute right-2 z-20 ${isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenuId(isMenuOpen ? null : project.id);
                }}
                className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <MoreHorizontal size={16} />
              </button>

              {/* Popover Menu */}
              {isMenuOpen && (
                <div ref={menuRef} className="absolute top-8 right-0 w-48 bg-[#0a0e17] border border-white/10 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.5)] z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                  <div className="p-1 flex flex-col gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onAddProject(project.id); setActiveMenuId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <FolderPlus size={14} className="text-emerald-400" /> Add Sub-project
                    </button>
                    <div className="h-px bg-white/5 my-0.5" />
                    <button
                      onClick={(e) => { e.stopPropagation(); onMoveProject(project.id, 'up'); setActiveMenuId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <ArrowUp size={14} /> Move Up
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onMoveProject(project.id, 'down'); setActiveMenuId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <ArrowDown size={14} /> Move Down
                    </button>
                    <div className="h-px bg-white/5 my-0.5" />
                    <button
                      onClick={(e) => { e.stopPropagation(); onTogglePin(project.id); setActiveMenuId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                      {project.pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin</>}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); setActiveMenuId(null); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nested Children */}
        {hasVisibleChildren && isExpanded && (
          <div className="flex flex-col gap-1">
            {children.map(child => <ProjectItem key={child.id} project={child} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  };

  const displayProjects = useMemo(() => {
    if (!projectSearch) return projects.filter(p => !p.parentId);
    return projects.filter(p =>
      p.name.toLowerCase().includes(projectSearch.toLowerCase())
    );
  }, [projects, projectSearch]);

  const pinnedProjects = projects.filter(p => p.pinned).sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <aside
      className={`
            h-[96vh] fixed left-4 top-[2vh] liquid-glass flex-col z-40 transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]
            hidden md:flex shadow-2xl
            ${isCollapsed ? 'w-20' : 'w-80'}
        `}
    >
      {/* Header Logo */}
      <div className={`p-6 pb-2 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} transition-all`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center shrink-0 relative group">
            <img src={logo} alt="Logo" className="w-8 h-8 object-contain relative z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight whitespace-nowrap text-glow">
                Liqui<span className="text-red-500 font-light">Task</span>
              </h1>

            </div>
          )}
        </div>
      </div>

      {/* Collapse Toggle */}
      <div className="flex justify-end px-4 mb-4">
        <button
          onClick={toggleSidebar}
          className="p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
        >
          {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Scrollable Area */}
      <div className="px-3 flex-1 overflow-y-auto custom-scrollbar space-y-6 pb-4">

        {/* Dashboard Nav */}
        <div
          onClick={() => onChangeView('dashboard')}
          className={`
            group px-3 py-3 rounded-xl cursor-pointer transition-all duration-300
            flex items-center relative overflow-hidden border border-transparent
            ${isCollapsed ? 'justify-center' : ''}
            ${currentView === 'dashboard' ? 'bg-gradient-to-r from-red-900/40 to-transparent border-red-500/20 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}
          `}
          title="Dashboard"
        >
          <div className="relative z-10 flex items-center gap-3">
            <LayoutDashboard size={20} className={`shrink-0 transition-colors ${currentView === 'dashboard' ? 'text-red-400 drop-shadow-md' : 'group-hover:text-red-400'}`} />
            {!isCollapsed && <span className="font-medium text-sm">Dashboard</span>}
          </div>
        </div>

        {/* Search Bar */}
        {!isCollapsed && (
          <div className="px-1 relative group">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-red-400 transition-colors" />
            <input
              type="text"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search workspaces..."
              className="w-full bg-[#050000]/50 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-red-500/30 transition-all"
            />
          </div>
        )}

        {/* Pinned Section */}
        {pinnedProjects.length > 0 && !projectSearch && (
          <div className="space-y-1">
            {!isCollapsed && (
              <div className="flex items-center gap-2 mb-2 px-2 text-slate-500">
                <Pin size={10} />
                <h2 className="text-[10px] font-bold uppercase tracking-widest">Pinned</h2>
              </div>
            )}
            {pinnedProjects.map((project) => (
              <ProjectItem key={project.id} project={project} depth={0} />
            ))}
            {!isCollapsed && <div className="h-px bg-white/5 mx-2 mt-4"></div>}
          </div>
        )}

        {/* Workspaces Section */}
        <div className="space-y-1">
          {!isCollapsed && (
            <div className="flex items-center justify-between mb-2 px-2">
              <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Workspaces</h2>
              <button
                onClick={() => onAddProject()}
                className="p-1 hover:bg-white/10 rounded text-slate-500 hover:text-red-400 transition-colors"
                title="New Workspace"
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          {isCollapsed && (
            <button
              onClick={() => onAddProject()}
              className="w-full p-3 mb-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-all flex justify-center"
              title="Add New Project"
            >
              <Plus size={18} />
            </button>
          )}

          {/* List Projects */}
          {displayProjects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              depth={projectSearch ? 0 : 0}
            />
          ))}

          {displayProjects.length === 0 && !isCollapsed && (
            <div className="px-4 py-6 text-center text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">
              {projectSearch ? 'No matching workspaces.' : 'No workspaces yet.'}
            </div>
          )}
        </div>

      </div>

      {/* Footer */}
      <div className="mt-auto p-4 border-t border-white/5 bg-[#050000]/30 backdrop-blur-md rounded-b-3xl">
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-3 px-3 py-2.5 w-full rounded-xl hover:bg-white/5 cursor-pointer text-slate-400 hover:text-white transition-colors border border-transparent hover:border-white/5 ${isCollapsed ? 'justify-center' : ''}`}
          title="Settings"
        >
          <Settings size={20} />
          {!isCollapsed && <span className="text-sm font-medium">Settings</span>}
        </button>
      </div>
    </aside>
  );
};