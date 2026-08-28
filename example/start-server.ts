import { startTransferServer } from "../src/server.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting transfer server (anonymous registration)...`);

const server = startTransferServer({
  port,
  staticRoot: projectRoot,
});

console.log();
console.log(`Open in browser:`);
console.log(`  Producer:  http://localhost:${port}/produce.html`);
console.log(`  Consumer:  http://localhost:${port}/consume.html`);
console.log(`  Links:     http://localhost:${port}/links`);
