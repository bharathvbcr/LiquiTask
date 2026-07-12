/** Shared prompt templates for auto-organize / AI organize flows. */

export function fillOrganizePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

export const CLUSTER_TASKS_PROMPT = `Analyze these tasks and group them into thematic clusters based on semantic similarity, shared context, and related objectives.

Return a JSON array where each object has:
{
  "taskIds": ["task_id_1", "task_id_2"],
  "theme": "A concise theme name for this group",
  "suggestedTags": ["tag1", "tag2"],
  "confidence": 0.85
}

Rules:
- Each task should appear in exactly ONE cluster
- Clusters should have at least 2 tasks
- Themes should be specific and actionable
- Suggested tags should use namespace format (e.g., "frontend:react", "backend:api")
- Confidence should reflect how cohesive the cluster is (0.0-1.0)

Context:
Workspace: {workspace}
Available Priorities: {priorities}
Today's Date: {date}

Tasks:
{tasks}`;

export const DETECT_HIERARCHY_PROMPT = `Analyze these tasks and identify implicit parent-child relationships, dependency chains, and tasks that should be subtasks of other tasks.

Return a JSON array where each object has:
{
  "type": "parent-child" | "dependency-chain" | "subtask-promotion",
  "parentTaskId": "the_parent_task_id",
  "childTaskIds": ["child_1", "child_2"],
  "confidence": 0.85,
  "reasoning": "Why these tasks form a hierarchy"
}

Rules:
- "parent-child": Tasks where one naturally contains the others
- "dependency-chain": Tasks that should be completed in sequence
- "subtask-promotion": Standalone tasks that belong as subtasks of a larger task
- Do not suggest hierarchies for tasks already linked
- Confidence should reflect clarity of the relationship
- Max 3 levels of nesting

Context:
Workspace: {workspace}
Today's Date: {date}

Tasks:
{tasks}`;

export const SUGGEST_PROJECT_ASSIGNMENT_PROMPT = `Analyze these tasks and suggest which project/workspace each task should belong to based on content, tags, and context.

Return a JSON array where each object has:
{
  "taskId": "task_id",
  "suggestedProjectId": "project_id",
  "confidence": 0.85,
  "reasoning": "Why this project is a better fit"
}

Rules:
- Only suggest moves when confidence is high
- Consider task tags, title keywords, and summary content
- Do not suggest moves for tasks already well-placed
- Available projects are listed below

Context:
Workspace: {workspace}
Available Projects: {projects}
Today's Date: {date}

Tasks:
{tasks}`;

export const CONSOLIDATE_TAGS_PROMPT = `Analyze all tags used across these tasks and identify tags that should be consolidated (merged) because they represent the same concept.

Return a JSON array where each object has:
{
  "tags": ["tag1", "tag2", "tag3"],
  "suggestedTag": "canonical_tag",
  "affectedTaskIds": ["task_id_1", "task_id_2"],
  "confidence": 0.85,
  "reasoning": "Why these tags should be merged"
}

Rules:
- Look for synonyms, typos, and variations (e.g., "bug" vs "bugfix" vs "bug-fix")
- Suggested tag should be the most common or clearest form
- Use namespace format when applicable (e.g., "frontend:react")
- Only suggest consolidations with high confidence
- Consider the full list of all unique tags below

All unique tags across tasks:
{allTags}

Tasks:
{tasks}`;

export const AUTO_TAG_PROMPT = `Analyze these tasks and suggest relevant tags for each one.

Return a JSON array where each object has:
{
  "taskId": "task_id",
  "suggestedTags": ["namespace:tag1", "namespace:tag2"],
  "suggestedPriority": "priority_id_or_omit",
  "confidence": 0.85,
  "reasoning": "Why these tags are relevant"
}

Rules:
- Use namespace format: "category:value" (e.g., "frontend:react", "backend:api", "docs:guide")
- Suggest 2-5 tags per task
- Tags should be specific and actionable
- Avoid generic tags like "task" or "work"
- Consider existing tags and avoid duplicates
- Optionally suggest a priority when the task clearly warrants it

Context:
Workspace: {workspace}
Available Priorities: {priorities}
Today's Date: {date}

Tasks:
{tasks}`;
