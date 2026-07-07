#!/usr/bin/env node
/**
 * Stdio MCP bridge for LiquiTask agent runs.
 * Claude Code connects via --mcp-config; tool calls are forwarded to the app
 * through a request/response directory (LIQUITASK_MCP_DIR).
 */
import fs from "node:fs";
import path from "node:path";

const MCP_DIR = process.env.LIQUITASK_MCP_DIR;
const TASK_ID = process.env.LIQUITASK_TASK_ID ?? "";
const RUN_ID = process.env.LIQUITASK_RUN_ID ?? "";

if (!MCP_DIR) {
  console.error("LIQUITASK_MCP_DIR is required");
  process.exit(1);
}

const REQUESTS_DIR = path.join(MCP_DIR, "requests");
const RESPONSES_DIR = path.join(MCP_DIR, "responses");
const GUIDANCE_FILE = path.join(MCP_DIR, "guidance.jsonl");

for (const dir of [REQUESTS_DIR, RESPONSES_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const TOOLS = [
  {
    name: "get_task",
    description:
      "Fetch the agent's task card (title, description, subtasks, current status) and the board's column layout. Call this first to orient yourself.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "update_status",
    description:
      "Move the agent's task card to a board column by id or title. Board lifecycle: Task → In Progress → Completed → Commit. The Commit column is human-gated — use complete_task when you finish instead of moving there.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: 'Column id or title (e.g. "In Progress", "Completed")',
        },
      },
      required: ["status"],
    },
  },
  {
    name: "complete_task",
    description:
      "Signal that your work on this task is DONE. Verified before acceptance: your card must be In Progress, and if you work in an isolated worktree it must contain actual changes (dirty files or commits) unless you pass no_changes: true. On success the card moves to Completed, where a human reviews your diff and commits/merges the worktree. Call this exactly once, as your final board action.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One-paragraph summary of what changed and anything left open",
        },
        no_changes: {
          type: "boolean",
          description:
            "Set true ONLY when the task genuinely required no code changes (explain why in summary)",
        },
      },
    },
  },
  {
    name: "get_worktree_state",
    description:
      "Inspect your isolated git worktree: branch name, count of uncommitted (dirty) files, commits ahead of the main checkout, and last commit. Call before complete_task to confirm your work is actually captured.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "post_comment",
    description:
      "Add a progress note to the task's activity trail. Post one when you start a major step, hit something surprising, or finish a milestone — this is how the user follows your progress on the board.",
    inputSchema: {
      type: "object",
      properties: {
        comment: { type: "string", description: "Comment text" },
      },
      required: ["comment"],
    },
  },
  {
    name: "create_subtask",
    description: "Create an open subtask under the agent's current task.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Subtask title" },
      },
      required: ["title"],
    },
  },
  {
    name: "toggle_subtask",
    description: "Check off (or reopen) a subtask on the current task by title or id.",
    inputSchema: {
      type: "object",
      properties: {
        subtask: { type: "string", description: "Subtask title or id" },
        completed: {
          type: "boolean",
          description: "Target state; omit to toggle",
        },
      },
      required: ["subtask"],
    },
  },
  {
    name: "report_blocker",
    description: "File a blocker as a new task linked to the current work.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Blocker title" },
        description: { type: "string", description: "Optional details" },
      },
      required: ["title"],
    },
  },
  {
    name: "get_user_guidance",
    description:
      "Fetch pending user guidance injected mid-run from the LiquiTask board. Call at the start of each major step and before large refactors.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "permission_prompt",
    description:
      "Handle permission requests from Claude Code (--permission-prompt-tool). Returns allow/deny JSON.",
    inputSchema: {
      type: "object",
      properties: {
        tool_use_id: { type: "string", description: "Claude tool use id" },
        tool_name: { type: "string", description: "Tool awaiting approval (e.g. Bash, Write)" },
        input: { type: "object", description: "Tool input payload" },
      },
      required: ["tool_use_id", "tool_name"],
    },
  },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function waitForResponse(requestId, timeoutMs = 30000) {
  const responsePath = path.join(RESPONSES_DIR, `${requestId}.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(responsePath)) {
      const raw = fs.readFileSync(responsePath, "utf8");
      fs.unlinkSync(responsePath);
      return JSON.parse(raw);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  throw new Error(`MCP request ${requestId} timed out`);
}

function readPendingGuidance() {
  if (!fs.existsSync(GUIDANCE_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(GUIDANCE_FILE, "utf8").trim();
  if (!raw) return [];
  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.message) messages.push(String(parsed.message));
    } catch {
      messages.push(line);
    }
  }
  fs.writeFileSync(GUIDANCE_FILE, "");
  return messages;
}

function callTool(name, args) {
  if (name === "get_user_guidance") {
    const messages = readPendingGuidance();
    if (messages.length === 0) {
      return [{ type: "text", text: "No new user guidance." }];
    }
    return [
      {
        type: "text",
        text: `User guidance (${messages.length} message(s)):\n${messages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`,
      },
    ];
  }
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(
    path.join(REQUESTS_DIR, `${requestId}.json`),
    JSON.stringify({ requestId, tool: name, args, taskId: TASK_ID, runId: RUN_ID }),
  );
  // Permission prompts wait for user approval in the UI — allow up to 10 minutes.
  const timeoutMs = name === "permission_prompt" ? 600_000 : 30_000;
  const result = waitForResponse(requestId, timeoutMs);
  if (result.error) throw new Error(result.error);
  return result.content ?? [{ type: "text", text: JSON.stringify(result) }];
}

function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "liquitask", version: "1.0.0" },
      },
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    try {
      const content = callTool(params.name, params.arguments ?? {});
      send({
        jsonrpc: "2.0",
        id,
        result: { content, isError: false },
      });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        },
      });
    }
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim()) handleMessage(line);
  }
});
