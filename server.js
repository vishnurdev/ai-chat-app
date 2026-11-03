// Local development server (no dependencies).
// Usage:  node server.js   then open http://localhost:3000
// Reads GROQ_API_KEY from a .env file in this folder.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import handler from "./api/chat.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const PUBLIC = new Set(["/index.html", "/style.css", "/app.js", "/markdown.js", "/logo.png", "/favicon.png"]);

// minimal .env loader
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/chat") {
      const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: "half" });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      return res.end();
    }

    const path = url.pathname === "/" ? "/index.html" : normalize(url.pathname).replace(/\\/g, "/");
    if (!PUBLIC.has(path)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log(`Zeeva running at http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) console.warn("Warning: GROQ_API_KEY is not set. Add it to a .env file.");
});
