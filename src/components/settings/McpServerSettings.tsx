import { Plus, Server, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

import userMcpConfigService, {
  createEmptyUserMcpServer,
} from "../../services/agents/userMcpConfigService";
import type { ToastType, UserMcpServer } from "../../../types";
import { SettingsToggle } from "./SettingsToggle";

interface McpServerSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
}

export const McpServerSettings: React.FC<McpServerSettingsProps> = ({ addToast }) => {
  const [servers, setServers] = useState<UserMcpServer[]>(() =>
    userMcpConfigService.getUserMcpServers(),
  );

  const persist = useCallback(
    (next: UserMcpServer[]) => {
      setServers(next);
      userMcpConfigService.saveUserMcpServers(next);
    },
    [],
  );

  const updateServer = (id: string, patch: Partial<UserMcpServer>) => {
    persist(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleAdd = () => {
    persist([...servers, createEmptyUserMcpServer()]);
  };

  const handleRemove = (id: string) => {
    persist(servers.filter((s) => s.id !== id));
    addToast("MCP server removed", "info");
  };

  const handleSaveRow = (server: UserMcpServer) => {
    if (!server.name.trim()) {
      addToast("Server name is required", "error");
      return;
    }
    if (server.transport === "stdio" && !server.command?.trim()) {
      addToast("Command is required for stdio servers", "error");
      return;
    }
    if (server.transport === "http" && !server.url?.trim()) {
      addToast("URL is required for HTTP servers", "error");
      return;
    }
    persist(servers.map((s) => (s.id === server.id ? server : s)));
    addToast(`Saved MCP server "${server.name}"`, "success");
  };

  return (
    <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-red-400" />
        <h4 className="text-sm font-medium text-white">Custom MCP servers</h4>
      </div>
      <p className="text-xs text-slate-500">
        User-defined MCP servers are merged into every agent run alongside the LiquiTask board
        bridge and DevCouncil. Use stdio for local binaries or HTTP for remote servers.
      </p>

      {servers.length === 0 && (
        <p className="text-xs text-slate-500 italic">No custom servers configured.</p>
      )}

      {servers.map((server) => (
        <div
          key={server.id}
          className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={server.name}
              onChange={(e) => updateServer(server.id, { name: e.target.value })}
              placeholder="server-name"
              className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
            />
            <select
              value={server.transport}
              onChange={(e) =>
                updateServer(server.id, {
                  transport: e.target.value as UserMcpServer["transport"],
                })
              }
              className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <SettingsToggle
              aria-label="Enabled"
              checked={server.enabled}
              onChange={(enabled) => updateServer(server.id, { enabled })}
            />
            <button
              type="button"
              onClick={() => handleRemove(server.id)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10"
              aria-label="Remove server"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {server.transport === "stdio" ? (
            <>
              <input
                type="text"
                value={server.command ?? ""}
                onChange={(e) => updateServer(server.id, { command: e.target.value })}
                placeholder="command (e.g. npx)"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
              />
              <input
                type="text"
                value={(server.args ?? []).join(" ")}
                onChange={(e) =>
                  updateServer(server.id, {
                    args: e.target.value.split(/\s+/).filter(Boolean),
                  })
                }
                placeholder="args (space-separated)"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
              />
            </>
          ) : (
            <input
              type="url"
              value={server.url ?? ""}
              onChange={(e) => updateServer(server.id, { url: e.target.value })}
              placeholder="https://example.com/mcp"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono"
            />
          )}

          <button
            type="button"
            onClick={() => handleSaveRow(server)}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20"
          >
            Save server
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={handleAdd}
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
      >
        <Plus size={13} /> Add MCP server
      </button>
    </div>
  );
};

export default McpServerSettings;
