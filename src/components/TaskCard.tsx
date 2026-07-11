import type React from "react";
import { memo, useState } from "react";
import agentDispatchService from "../services/agents/agentDispatchService";
import agentRunService from "../services/agents/agentRunService";
import { useAgentTaskStatus } from "../hooks/useAgentTaskStatus";
import { useTaskCardContextMenu } from "../hooks/useTaskCardContextMenu";
import { COLUMN_STATUS } from "../constants";
import { getDueDateStatus } from "../utils/taskCardUtils";
import { GlassCard } from "../ui";
import type { AgentRun, PriorityDefinition, Project, Task } from "../../types";
import { TaskCardAgentReview } from "./taskCard/TaskCardAgentReview";
import { TaskCardBody } from "./taskCard/TaskCardBody";
import { TaskCardContextMenu } from "./taskCard/TaskCardContextMenu";
import { TaskCardFooter } from "./taskCard/TaskCardFooter";
import { TaskCardHeader } from "./taskCard/TaskCardHeader";
import { TaskCardPermissionBar } from "./taskCard/TaskCardPermissionBar";
import { TaskCardPrChip } from "./taskCard/TaskCardPrChip";

interface TaskCardProps {
  task: Task;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  priorities?: PriorityDefinition[];
  allTasks?: Task[];
  isCompact?: boolean;
  onCopyTask?: (message: string) => void;
  onDuplicateAsQuickAdd?: (task: Task) => void;
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
  agentDispatchEnabled?: boolean;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onMoveTask,
  onEditTask,
  onUpdateTask,
  onDeleteTask,
  onArchiveTask,
  priorities = [],
  allTasks = [],
  isCompact = false,
  onCopyTask,
  onDuplicateAsQuickAdd,
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
  agentDispatchEnabled = true,
}) => {
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");

  // The card is clean by default and reveals its summary + editing chrome on
  // hover / keyboard focus, driven purely by CSS `group-hover` / `group-focus-within`.

  const {
    isAgentTask,
    sending,
    runStatus,
    queuePosition,
    pendingPermission,
    permissionRequest,
    activeRunId,
    completedRun,
  } = useAgentTaskStatus(task.id, task.assignee);
  const agentWorking = runStatus === "running" || runStatus === "verifying";

  // Hover quick-send: one click smart-matches the card to an agent. Hidden
  // while a run is active/in flight or when no agent can take work.
  const dispatchReady = agentDispatchService.canDispatch();
  const canQuickSend =
    agentDispatchEnabled &&
    dispatchReady &&
    !runStatus &&
    !sending &&
    task.status !== COLUMN_STATUS.COMPLETED &&
    task.status !== COLUMN_STATUS.IN_REVIEW &&
    task.status !== COLUMN_STATUS.COMMIT;
  const showAgentReview =
    isAgentTask &&
    task.status === COLUMN_STATUS.COMPLETED &&
    !agentWorking &&
    completedRun?.status === "completed" &&
    onApproveAgentWork &&
    onRejectAgentWork;

  const {
    contextMenuVisible,
    setContextMenuVisible,
    contextMenuPosition,
    showWorkspaceSubmenu,
    showAgentSubmenu,
    dispatchAgents,
    offerAgentSetup,
    handleContextMenu,
    handleCopyAsJson,
    handleDuplicateAsQuickAdd,
    handleMoveToWorkspace,
    handleDeleteTask,
    handleSendToAgent,
    handleAgentSetup,
    handleWorkspaceSubmenuEnter,
    handleWorkspaceSubmenuLeave,
    handleAgentSubmenuEnter,
    handleAgentSubmenuLeave,
  } = useTaskCardContextMenu({
    task,
    projectName,
    onCopyTask,
    onDuplicateAsQuickAdd,
    onMoveToWorkspace,
    onDeleteTask,
    agentsEnabled: agentDispatchEnabled,
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
          linkedTask !== undefined && linkedTask.status !== COLUMN_STATUS.COMMIT,
      ) ?? [];

  const isBlocked = blockingTasks.length > 0;
  const blockerIds = blockingTasks.map((t) => t.jobId).join(", ");

  return (
    <>
      <GlassCard
        ref={sortableRef}
        style={sortableStyle}
        {...sortableAttributes}
        {...sortableListeners}
        role="article"
        aria-label={`Task: ${task.title}`}
        onContextMenu={handleContextMenu}
        onDoubleClick={() => onEditTask(task)}
        className={`
          group relative w-full min-w-0 overflow-hidden ${isCompact ? "p-3.5" : "p-5"} cursor-grab active:cursor-grabbing
          hover:border-white/20 outline-none
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
          isBlocked={isBlocked}
          blockerIds={blockerIds}
          isSelected={isSelected}
          onToggleSelect={onToggleSelect}
          onQuickSend={
            canQuickSend ? () => void agentDispatchService.dispatch(task) : undefined
          }
        />

        <TaskCardBody
          task={task}
          subtasks={subtasks}
          completedSubtasks={completedSubtasks}
          progress={progress}
          isSubtasksExpanded={isSubtasksExpanded}
          onToggleSubtasksExpanded={() => setIsSubtasksExpanded(!isSubtasksExpanded)}
          onSubtaskToggle={handleSubtaskToggle}
          onSubtaskTitleChange={handleSubtaskTitleChange}
        />

        {(task.prState?.url || task.prState?.state) && (
          <TaskCardPrChip prState={task.prState} compact={isCompact} />
        )}

        <TaskCardFooter
          task={task}
          showMarkCommittedButton={task.status === COLUMN_STATUS.COMPLETED && !showAgentReview}
          showArchiveButton={task.status === COLUMN_STATUS.COMMIT}
          onArchiveTask={onArchiveTask}
          isAgentTask={isAgentTask}
          agentWorking={agentWorking}
          runStatus={runStatus}
          sending={sending}
          queuePosition={queuePosition}
          pendingPermission={pendingPermission}
          onCancelRun={
            activeRunId ? () => void agentRunService.cancel(activeRunId) : undefined
          }
          dueInfo={dueInfo}
          onMoveTask={onMoveTask}
        />

        {permissionRequest && <TaskCardPermissionBar request={permissionRequest} />}

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
      </GlassCard>

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
        onDuplicateAsQuickAdd={
          onDuplicateAsQuickAdd ? handleDuplicateAsQuickAdd : undefined
        }
        onMoveToWorkspaceSelect={handleMoveToWorkspace}
        onDeleteTask={handleDeleteTask}
        onArchiveTask={
          task.status === COLUMN_STATUS.COMMIT && onArchiveTask
            ? () => {
                onArchiveTask(task.id);
                setContextMenuVisible(false);
              }
            : undefined
        }
        dispatchAgents={dispatchAgents}
        showAgentSubmenu={showAgentSubmenu}
        onAgentSubmenuEnter={handleAgentSubmenuEnter}
        onAgentSubmenuLeave={handleAgentSubmenuLeave}
        onSendToAgent={handleSendToAgent}
        offerAgentSetup={offerAgentSetup}
        onAgentSetup={handleAgentSetup}
      />
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
