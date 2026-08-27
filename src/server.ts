import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Store } from "./store.js";
import { ConnectionManager } from "./connection-manager.js";
import { MessageHandler } from "./message-handler.js";
import type { SocketLike } from "./types.js";

export interface TransferServerOptions {
  port: number;
  /** Root directory for serving static files (example/, dist/). Defaults to cwd. */
  staticRoot?: string;
}

/**
 * Start the transfer server:
 * - HTTP endpoints: /config (token generation), /links (query connections)
 * - WebSocket server: register, list, subscribe, produce/consume forwarding
 */
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
};

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] ?? "application/octet-stream";
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

export function startTransferServer(options: TransferServerOptions) {
  const { port } = options;
  const staticRoot = options.staticRoot ?? process.cwd();

  const store = new Store();

  const connectionManager = new ConnectionManager(store);
  const messageHandler = new MessageHandler(store);

  // ===== HTTP Server =====
  const httpServer = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/links" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getLinksPageHtml());
      return;
    }

    if (url.pathname === "/api/links" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { uid, token } = JSON.parse(body);
          if (!store.verifyUser(uid, token)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid credentials" }));
            return;
          }
          const connections = store.getConnectionsByUser(uid, token);
          const list = connections.map((c) => ({ uuid: c.uuid, name: c.name }));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ list }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request body" }));
        }
      });
      return;
    }

    if (url.pathname === "/api/update-token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const { uid, newToken } = JSON.parse(body);
          if (!/^\d{11}$/.test(uid)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid uid" }));
            return;
          }
          store.addUser(uid, newToken);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ uid, token: newToken }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid request body" }));
        }
      });
      return;
    }

    // ===== Static file serving =====
    const pathname = url.pathname === "/" ? "/produce.html" : url.pathname;
    // Try example/ first, then project root (for /dist/client.browser.js etc.)
    const cleanPath = pathname.replace(/^\//, "");
    const examplePath = join(staticRoot, "example", cleanPath);
    const rootPath = join(staticRoot, cleanPath);
    if (serveStaticFile(res, examplePath) || serveStaticFile(res, rootPath)) return;

    res.writeHead(404);
    res.end("Not Found");
  });

  // ===== WebSocket Server =====
  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    const socket = ws as unknown as SocketLike;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        messageHandler.handleMessage(socket, msg);
      } catch {
        // Invalid JSON, ignore
      }
    });

    ws.on("close", () => {
      messageHandler.handleClose(socket, (uuid) => {
        // Producer disconnected → mark only (don't clear subscribers yet)
        // Subscribers will be notified on timeout or on re-register with new token
        connectionManager.markDisconnected(uuid);
      });
    });
  });

  // ===== Timeout cleanup =====
  const cleanupInterval = setInterval(() => {
    connectionManager.cleanupTimedOut();
  }, 30_000); // Check every 30s

  // ===== Start =====
  httpServer.listen(port, () => {
    console.log(`Transfer server listening on :${port}`);
    console.log(`  Producer: http://localhost:${port}/produce.html`);
    console.log(`  Consumer: http://localhost:${port}/consume.html`);
    console.log(`  Links:    http://localhost:${port}/links`);
    console.log(`  WS:       ws://localhost:${port}`);
  });

  return {
    store,
    connectionManager,
    messageHandler,
    close: () => {
      clearInterval(cleanupInterval);
      wss.close();
      httpServer.close();
    },
  };
}

// ===== HTML Pages =====

function getLinksPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Available Links</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px}
input{width:100%;padding:8px;margin:8px 0;box-sizing:border-box}
button{padding:10px 20px;cursor:pointer}table{width:100%;border-collapse:collapse}
td,th{border:1px solid #ddd;padding:8px;text-align:left}
</style></head><body>
<h1>Query Available Links</h1>
<input id="uid" placeholder="Phone number (11 digits)" maxlength="11" />
<input id="token" placeholder="Token (64 chars)" maxlength="64" />
<button onclick="query()">Query</button>
<table><thead><tr><th>UUID</th><th>Name</th></tr></thead>
<tbody id="list"><tr><td colspan="2">Enter credentials and click Query</td></tr></tbody>
</table>
<script>
async function query() {
  const uid = document.getElementById('uid').value;
  const token = document.getElementById('token').value;
  const res = await fetch('/api/links', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ uid, token })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  const tbody = document.getElementById('list');
  tbody.innerHTML = data.list.length === 0
    ? '<tr><td colspan="2">No connections found</td></tr>'
    : data.list.map(c => '<tr><td>'+c.uuid+'</td><td>'+c.name+'</td></tr>').join('');
}
</script></body></html>`;
}
