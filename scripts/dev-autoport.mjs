#!/usr/bin/env node
/**
 * Start `tauri dev` on a free loopback port when the default (4000) is taken.
 * Sets PORT for Vite (beforeDevCommand) and overrides build.devUrl for the shell.
 */
import { spawn } from "node:child_process";
import net from "node:net";

const DEFAULT_PORT = 4000;
const MAX_ATTEMPTS = 50;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start, attempts) {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + attempts - 1}`);
}

const tauriArgs = process.argv.slice(2);
const requestedPort = process.env.PORT ? Number(process.env.PORT) : null;
const port =
  requestedPort && Number.isFinite(requestedPort) && requestedPort > 0
    ? requestedPort
    : await findFreePort(DEFAULT_PORT, MAX_ATTEMPTS);

const devUrl = `http://localhost:${port}`;
const configOverride = JSON.stringify({ build: { devUrl } });

if (port !== DEFAULT_PORT) {
  console.log(`Port ${DEFAULT_PORT} is in use; using ${port} for dev.`);
}

const child = spawn(
  "npx",
  ["tauri", "dev", "--config", configOverride, ...tauriArgs],
  {
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) },
    shell: process.platform === "win32",
  },
);

const forwardSignal = (signal) => {
  if (!child.killed) child.kill(signal);
};
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
