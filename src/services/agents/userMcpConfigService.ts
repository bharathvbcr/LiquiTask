import { STORAGE_KEYS } from "../../constants";
import storageService from "../storageService";
import type { UserMcpServer } from "../../../types";

const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

function normalizeServer(raw: UserMcpServer): UserMcpServer | null {
  const name = raw.name.trim();
  if (!NAME_RE.test(name)) return null;
  if (raw.transport === "stdio") {
    const command = raw.command?.trim();
    if (!command) return null;
    return {
      id: raw.id,
      name,
      transport: "stdio",
      command,
      args: raw.args?.filter((a) => a.trim().length > 0) ?? [],
      env: raw.env,
      enabled: raw.enabled !== false,
    };
  }
  const url = raw.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    id: raw.id,
    name,
    transport: "http",
    url,
    enabled: raw.enabled !== false,
  };
}

export function getUserMcpServers(): UserMcpServer[] {
  const stored = storageService.get<UserMcpServer[]>(STORAGE_KEYS.USER_MCP_SERVERS, []) ?? [];
  return stored
    .map((entry) => normalizeServer(entry))
    .filter((entry): entry is UserMcpServer => entry !== null);
}

export function saveUserMcpServers(servers: UserMcpServer[]): void {
  void storageService.set(STORAGE_KEYS.USER_MCP_SERVERS, servers);
}

export function getEnabledUserMcpServers(): UserMcpServer[] {
  return getUserMcpServers().filter((s) => s.enabled);
}

/** Convert a user server into the mcpServers map shape agentd expects. */
export function userMcpServerToConfigEntry(server: UserMcpServer): Record<string, unknown> {
  if (server.transport === "http") {
    return { url: server.url };
  }
  const entry: Record<string, unknown> = {
    command: server.command,
    args: server.args ?? [],
  };
  if (server.env && Object.keys(server.env).length > 0) {
    entry.env = server.env;
  }
  return entry;
}

export function createEmptyUserMcpServer(): UserMcpServer {
  return {
    id: crypto.randomUUID(),
    name: "",
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    enabled: true,
  };
}

export default {
  getUserMcpServers,
  saveUserMcpServers,
  getEnabledUserMcpServers,
  userMcpServerToConfigEntry,
  createEmptyUserMcpServer,
};
