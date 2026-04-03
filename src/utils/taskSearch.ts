import type { Task } from "../../types";

export const filterTasksBySearch = (
  tasks: Task[],
  searchQuery: string,
  searchIndexService?: { search: (query: string) => string[] } | null,
) => {
  const trimmedQuery = searchQuery.trim();
  if (!trimmedQuery) {
    return tasks;
  }

  if (searchIndexService) {
    const matchedIds = new Set(searchIndexService.search(trimmedQuery));
    return tasks.filter((task) => matchedIds.has(task.id));
  }

  const normalizedQuery = trimmedQuery.toLowerCase();
  return tasks.filter(
    (task) =>
      task.title.toLowerCase().includes(normalizedQuery) ||
      task.subtitle?.toLowerCase().includes(normalizedQuery) ||
      task.summary?.toLowerCase().includes(normalizedQuery) ||
      task.jobId.toLowerCase().includes(normalizedQuery),
  );
};
