import type React from "react";
import { lazy, memo, Suspense, useState } from "react";
import { useAgentTaskStatus } from "../src/hooks/useAgentTaskStatus";
import { useTaskEstimateHint } from "../src/hooks/useEstimateSuggestion";
import { useTaskCardContextMenu } from "../src/hooks/useTaskCardContextMenu";
import { COLUMN_STATUS } from "../src/constants";
import { getDueDateStatus } from "../src/utils/taskCardUtils";
import type { AgentRun, PriorityDefinition, Project, Task } from "../types";
import { TaskCardAgentReview } from "./taskCard/TaskCardAgentReview";
import { TaskCardBody } from "./taskCard/TaskCardBody";
import { TaskCardContextMenu } from "./taskCard/TaskCardContextMenu";
import { TaskCardFooter } from "./taskCard/TaskCardFooter";
import { TaskCardHeader } from "./taskCard/TaskCardHeader";

const TaskQuickView = lazy(() => import("../src/components/TaskQuickView"));

interface TaskCardProps {
  task: Task;
  isCompletedColumn?: boolean;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  priorities?: PriorityDefinition[];
  allTasks?: Task[];
  isCompact?: boolean;
  onCopyTask?: (message: string) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  isFocused?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (taskId: string, shiftKey?: boolean) => void;
  onApproveAgentWork?: (task: Task, run: AgentRun) => void;
  onRejectAgentWork?: (task: Task, run: AgentRun, feedback: string) => void;
  sortableRef?: React.Ref<HTMLDivElement>;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLDivElement>;
  sortableListeners?: Record<string, unknown>;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  isCompletedColumn,
  onMoveTask,
  onEditTask,
  onUpdateTask,
  onDeleteTask,
  priorities = [],
  allTasks = [],
  isCompact = false,
  onCopyTask,
  projectName,
  projects = [],
  onMoveToWorkspace,
  isFocused = false,
  isSelected = false,
  onToggleSelect,
  onApproveAgentWork,
  onRejectAgentWork,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
}) => {
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [quickViewPosition, setQuickViewPosition] = useState<{ x: number; y: number } | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const { isAgentTask, runStatus, completedRun } = useAgentTaskStatus(task.id, task.assignee);
  const agentWorking = runStatus === "running" || runStatus === "verifying";
  const estimateHint = useTaskEstimateHint(task, allTasks);
  const showAgentReview =
    isAgentTask &&
    task.status === COLUMN_STATUS.REVIEW &&
    !agentWorking &&
    completedRun?.status === "completed" &&
    onApproveAgentWork &&
    onRejectAgentWork;

  const {
    contextMenuVisible,
    setContextMenuVisible,
    contextMenuPosition,
    showWorkspaceSubmenu,
    handleContextMenu,
    handleCopyAsJson,
    handleMoveToWorkspace,
    handleWorkspaceSubmenuEnter,
    handleWorkspaceSubmenuLeave,
  } = useTaskCardContextMenu({
    task,
    projectName,
    onCopyTask,
    onMoveToWorkspace,
  });

  const handleSubtaskToggle = (e: React.MouseEvent, subtaskId: string) => {
    e.stopPropagation();
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s,
    );
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const handleSubtaskTitleChange = (subtaskId: string, newTitle: string) => {
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, title: newTitle } : s,
    );
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const dueInfo = getDueDateStatus(task.dueDate);
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter((s) => s.completed).length;
  const progress = subtasks.length > 0 ? (completedSubtasks / subtasks.length) * 100 : 0;
  const priorityDef = priorities.find((p) => p.id === task.priority) || {
    id: task.priority,
    label: "Unknown",
    color: "#64748b",
    level: 0,
    icon: undefined,
  };

  const blockingTasks =
    task.links
      ?.filter((l) => l.type === "blocked-by")
      .map((l) => allTasks.find((t) => t.id === l.targetTaskId))
      .filter(
        (linkedTask): linkedTask is Task =>
          linkedTask !== undefined &&
          linkedTask.status !== "Completed" &&
          linkedTask.status !== "Delivered",
      ) ?? [];

  const isBlocked = blockingTasks.length > 0;
  const blockerIds = blockingTasks.map((t) => t.jobId).join(", ");

  return (
    <>
      <div
        ref={sortableRef}
        style={sortableStyle}
        {...sortableAttributes}
        {...sortableListeners}
        role="article"
        aria-label={`Task: ${task.title}`}
        onContextMenu={handleContextMenu}
        className={`
          liquid-card group relative w-full min-w-0 overflow-hidden rounded-2xl ${isCompact ? "p-3.5" : "p-5"} cursor-grab active:cursor-grabbing
          border border-white/10 hover:border-white/20 outline-none
          focus-visible:ring-2 focus-visible:ring-red-500/50
          ${isBlocked ? "border-l-2 border-l-red-500/50" : ""}
          ${isFocused ? "ring-2 ring-red-500/70 shadow-[0_0_20px_rgba(239,68,68,0.4)] scale-[1.02]" : ""}
          ${isSelected ? "ring-2 ring-cyan-400/80 border-cyan-400/50 shadow-[0_0_24px_rgba(34,211,238,0.22)]" : ""}
          hover:shadow-lg
        `}
        tabIndex={0}
      >
        <TaskCardHeader
          task={task}
          isCompact={isCompact}
          priorityDef={priorityDef}
          priorities={priorities}
          isBlocked={isBlocked}
          blockerIds={blockerIds}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          onEditTask={onEditTask}
          onDeleteTask={onDeleteTask}
          onUpdateTask={onUpdateTask}
          onQuickView={setQuickViewPosition}
        />

        <TaskCardBody
          task={task}
          isCompact={isCompact}
          isAgentTask={isAgentTask}
          agentWorking={agentWorking}
          dueInfo={dueInfo}
          subtasks={subtasks}
          completedSubtasks={completedSubtasks}
          progress={progress}
          isSubtasksExpanded={isSubtasksExpanded}
          onToggleSubtasksExpanded={() => setIsSubtasksExpanded(!isSubtasksExpanded)}
          onEditTask={onEditTask}
          onUpdateTask={onUpdateTask}
          onSubtaskToggle={handleSubtaskToggle}
          onSubtaskTitleChange={handleSubtaskTitleChange}
        />

        {!isCompact && (
          <TaskCardFooter
            task={task}
            isCompletedColumn={isCompletedColumn}
            isAgentTask={isAgentTask}
            agentWorking={agentWorking}
            runStatus={runStatus}
            dueInfo={dueInfo}
            estimateHint={estimateHint}
            onMoveTask={onMoveTask}
            onUpdateTask={onUpdateTask}
          />
        )}

        {showAgentReview && completedRun && onApproveAgentWork && onRejectAgentWork && (
          <TaskCardAgentReview
            task={task}
            completedRun={completedRun}
            isCompact={isCompact}
            rejectFeedback={rejectFeedback}
            onRejectFeedbackChange={setRejectFeedback}
            onApproveAgentWork={onApproveAgentWork}
            onRejectAgentWork={onRejectAgentWork}
          />
        )}
      </div>

      <TaskCardContextMenu
        visible={contextMenuVisible}
        position={contextMenuPosition}
        showWorkspaceSubmenu={showWorkspaceSubmenu}
        task={task}
        projects={projects}
        onMoveToWorkspace={onMoveToWorkspace}
        onCopyTask={onCopyTask}
        onClose={() => setContextMenuVisible(false)}
        onWorkspaceSubmenuEnter={handleWorkspaceSubmenuEnter}
        onWorkspaceSubmenuLeave={handleWorkspaceSubmenuLeave}
        onCopyAsJson={handleCopyAsJson}
        onMoveToWorkspaceSelect={handleMoveToWorkspace}
      />

      {quickViewPosition && (
        <Suspense fallback={null}>
          <TaskQuickView
            task={task}
            priorities={priorities}
            position={quickViewPosition}
            onClose={() => setQuickViewPosition(null)}
            onOpenFull={(selectedTask) => {
              setQuickViewPosition(null);
              onEditTask(selectedTask);
            }}
          />
        </Suspense>
      )}
    </>
  );
};

export const MemoizedTaskCard = memo(TaskCard, (prev, next) => {
  return (
    prev.task.id === next.task.id &&
    prev.task.updatedAt === next.task.updatedAt &&
    prev.isFocused === next.isFocused &&
    prev.isSelected === next.isSelected &&
    prev.isCompact === next.isCompact &&
    prev.priorities === next.priorities &&
    prev.allTasks === next.allTasks &&
    prev.projects === next.projects
  );
});
