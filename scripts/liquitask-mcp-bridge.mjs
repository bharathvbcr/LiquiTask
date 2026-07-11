#!/usr/bin/env node
/**
 * Stdio MCP bridge for LiquiTask agent runs.
 * Claude Code connects via --mcp-config; tool calls are forwarded to the app
 * through a request/response directory (LIQUITASK_MCP_DIR).
 *
 * Responses and guidance are HMAC-authenticated by the LiquiTask app; unsigned
 * files are ignored so a co-located process cannot forge approvals.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  isLegacyUnsignedResponse,
  readInflightBinding,
  unwrapBoundResponse,
  unwrapSignedPayload,
} from "./mcp-bridge-auth.mjs";

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

const MCP_DIR = process.env.LIQUITASK_MCP_DIR ?? "";

/** Read a secret from an inherited FD when agentd-owned spawn passes LIQUITASK_*_FD. */
export function readSecretFromFd(envName) {
  const raw = process.env[envName];
  if (!raw) return "";
  const fd = Number.parseInt(raw, 10);
  if (!Number.isFinite(fd) || fd < 0) return "";
  try {
    const buf = Buffer.alloc(64);
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    const secret = buf.subarray(0, n).toString("utf8").trim();
    return secret.length >= 32 ? secret : "";
  } catch {
    return "";
  }
}

/** Read the per-run HMAC secret — FD handoff first, then file fallback. */
export function readMcpSecretFromDir(mcpDir) {
  const fromFd = readSecretFromFd("LIQUITASK_MCP_SECRET_FD");
  if (fromFd) return fromFd;
  if (!mcpDir) return "";
  try {
    const raw = fs.readFileSync(path.join(mcpDir, ".secret"), "utf8").trim();
    return raw.length >= 32 ? raw : "";
  } catch {
    return "";
  }
}

/** Read the response-signing key — FD handoff first, then file fallback. */
export function readResponseSecretFromDir(mcpDir) {
  const fromFd = readSecretFromFd("LIQUITASK_RESPONSE_SECRET_FD");
  if (fromFd) return fromFd;
  if (!mcpDir) return "";
  try {
    const raw = fs.readFileSync(path.join(mcpDir, "response-secret"), "utf8").trim();
    return raw.length >= 32 ? raw : "";
  } catch {
    return "";
  }
}

const MCP_SECRET = readMcpSecretFromDir(MCP_DIR);
const RESPONSE_SECRET = readResponseSecretFromDir(MCP_DIR);
const TASK_ID = process.env.LIQUITASK_TASK_ID ?? "";
const RUN_ID = process.env.LIQUITASK_RUN_ID ?? "";

const REQUESTS_DIR = MCP_DIR ? path.join(MCP_DIR, "requests") : "";
const RESPONSES_DIR = MCP_DIR ? path.join(MCP_DIR, "responses") : "";
const INFLIGHT_DIR = MCP_DIR ? path.join(MCP_DIR, "inflight") : "";
const GUIDANCE_FILE = MCP_DIR ? path.join(MCP_DIR, "guidance.jsonl") : "";

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
    name: "board_list",
    description: "List board task cards, optionally filtered by column id or title.",
    inputSchema: {
      type: "object",
      properties: {
        column: { type: "string", description: "Column id or title filter" },
      },
    },
  },
  {
    name: "board_show",
    description: "Show one task card by id, job id, or title prefix.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id, job id, or title prefix" },
      },
      required: ["task"],
    },
  },
  {
    name: "board_create",
    description: "Create a new board task (meta-agent orchestration).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        projectId: { type: "string" },
        assignee: { type: "string" },
        status: { type: "string" },
        summary: { type: "string" },
      },
      required: ["title", "projectId"],
    },
  },
  {
    name: "board_assign",
    description: "Assign a task to an agent by name.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        assignee: { type: "string" },
      },
      required: ["task", "assignee"],
    },
  },
  {
    name: "board_dispatch",
    description: "Start an agent run for a task (respects scope reservations).",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        agent: { type: "string", description: "Agent name; defaults to task assignee" },
      },
      required: ["task"],
    },
  },
  {
    name: "board_reservations",
    description: "Read active file-scope reservations from the agentd daemon.",
    inputSchema: { type: "object", properties: {} },
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function parseResponsePayload(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isLegacyUnsignedResponse(parsed)) {
    return null;
  }
  return unwrapSignedPayload(MCP_SECRET, parsed);
}

/**
 * Poll for an app-signed response file. Unsigned/forged files are ignored.
 * @param {string} responsesDir
 * @param {string} inflightDir
 * @param {string} requestId
 * @param {string} secret
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 */
export function readAuthenticatedResponse(responsesDir, requestId, secret, opts = {}, inflightDir = "") {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = opts.pollMs ?? 50;
  const responsePath = path.join(responsesDir, `${requestId}.json`);
  const inflightPath = inflightDir ? path.join(inflightDir, `${requestId}.json`) : "";
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (inflightPath && !fs.existsSync(inflightPath)) {
      throw new Error(`MCP request ${requestId} is not inflight`);
    }
    if (fs.existsSync(responsePath)) {
      const binding = inflightPath ? readInflightBinding(inflightPath) : null;
      if (inflightPath && !binding) {
        fs.unlinkSync(responsePath);
        sleepMs(pollMs);
        continue;
      }
      const raw = fs.readFileSync(responsePath, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        fs.unlinkSync(responsePath);
        sleepMs(pollMs);
        continue;
      }
      const payload = isLegacyUnsignedResponse(parsed)
        ? null
        : binding
          ? unwrapBoundResponse(secret, parsed, binding)
          : unwrapSignedPayload(secret, parsed);
      if (!payload) {
        // Drop unsigned/forged files and keep waiting for an app-signed response.
        fs.unlinkSync(responsePath);
        sleepMs(pollMs);
        continue;
      }
      fs.unlinkSync(responsePath);
      return payload;
    }
    sleepMs(pollMs);
  }
  throw new Error(`MCP request ${requestId} timed out`);
}

function waitForResponse(requestId, timeoutMs = 30000) {
  return readAuthenticatedResponse(RESPONSES_DIR, requestId, RESPONSE_SECRET, { timeoutMs }, INFLIGHT_DIR);
}

/**
 * @param {string} guidanceFile
 * @param {string} secret
 */
export function readAuthenticatedGuidance(guidanceFile, secret) {
  if (!fs.existsSync(guidanceFile)) {
    return [];
  }
  const raw = fs.readFileSync(guidanceFile, "utf8").trim();
  if (!raw) return [];
  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (isLegacyUnsignedResponse(parsed)) {
        continue;
      }
      const payload = unwrapSignedPayload(secret, parsed);
      if (payload?.message) {
        messages.push(String(payload.message));
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  fs.writeFileSync(guidanceFile, "");
  return messages;
}

function readPendingGuidance() {
  return readAuthenticatedGuidance(GUIDANCE_FILE, MCP_SECRET);
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
  if (result.error) throw new Error(String(result.error));
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
if (isDirectRun) {
  if (!MCP_DIR) {
    console.error("LIQUITASK_MCP_DIR is required");
    process.exit(1);
  }
  if (!MCP_SECRET) {
    console.error("MCP secret missing: expected LIQUITASK_MCP_DIR/.secret (>=32 chars)");
    process.exit(1);
  }
  if (!RESPONSE_SECRET) {
    console.error("Response secret missing: expected LIQUITASK_MCP_DIR/response-secret (>=32 chars)");
    process.exit(1);
  }
  for (const dir of [REQUESTS_DIR, RESPONSES_DIR, INFLIGHT_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleMessage(line);
    }
  });
}
