import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import { TaskCard } from "../../components/TaskCard";
import type { AgentRun, PriorityDefinition, Project, Task } from "../../../types";

interface SortableTaskProps {
  task: Task;
  priorities: PriorityDefinition[];
  isCompletedColumn?: boolean;
  onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  allTasks: Task[];
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
}

export const SortableTask: React.FC<SortableTaskProps> = ({
  task,
  onCopyTask,
  projectName,
  projects,
  onMoveToWorkspace,
  isFocused = false,
  isSelected = false,
  onToggleSelect,
  ...props
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: "task", task },
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    touchAction: "none",
  };

  return (
    <TaskCard
      task={task}
      {...props}
      onCopyTask={onCopyTask}
      projectName={projectName}
      projects={projects}
      onMoveToWorkspace={onMoveToWorkspace}
      isFocused={isFocused}
      isSelected={isSelected}
      onToggleSelect={onToggleSelect}
      sortableRef={setNodeRef}
      sortableStyle={sortableStyle}
      sortableAttributes={attributes}
      sortableListeners={listeners}
    />
  );
};
