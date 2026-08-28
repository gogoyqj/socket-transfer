#!/usr/bin/env node
import { startTransferServer } from "./server.js";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

const port = parseInt(flag("port") ?? process.env.PORT ?? "3000", 10);
const staticRoot = flag("root");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: socket-transfer [options]

Options:
  --port <number>   Server port (default: 3000, env: PORT)
  --root <path>     Static file root directory (default: cwd)
  -h, --help        Show this help`);
  process.exit(0);
}

const opts: { port: number; staticRoot?: string } = { port };
if (staticRoot) opts.staticRoot = staticRoot;
const server = startTransferServer(opts);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
