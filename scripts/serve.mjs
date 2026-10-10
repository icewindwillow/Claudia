/** Local preview only. Binds to loopback; not a production server. */
import http from "node:http";
import {onRequest as mapConfig} from "../functions/api/maps.js";
import {serveTile} from "../server/tiles.mjs";
import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = await realpath(fileURLToPath(new URL("../public/", import.meta.url)));
const port = Number(process.env.PORT || 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
// This starter's _headers only contains a global /* rule.
const headers = Object.fromEntries((await readFile(path.join(root, "_headers"), "utf8")).split("\n").filter((line) => /^\s+[^#\s].*:/.test(line)).map((line) => { const index = line.indexOf(":"); return [line.slice(0, index).trim(), line.slice(index + 1).trim()]; }));
const isWithinRoot = (file) => file === root || file.startsWith(root + path.sep);
const server = http.createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch { res.writeHead(400).end("Bad request"); return; }
    if (pathname === '/api/maps' || pathname.startsWith('/api/tiles/')) {
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {method:req.method, headers:req.headers});
      const response = pathname === '/api/maps' ? mapConfig({request}) : await serveTile({request}, {cache:null});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      return;
    }
    const target = path.resolve(root, "." + pathname);
    if (pathname.includes("\0") || !isWithinRoot(target) || pathname.split("/").some((part) => part.startsWith(".") || part === "_headers" || part === "_redirects")) { res.writeHead(404).end("Not found"); return; }
    let file;
    try {
      file = await realpath(target);
      if (!isWithinRoot(file)) { res.writeHead(404).end("Not found"); return; }
      if ((await stat(file)).isDirectory()) file = await realpath(path.join(file, "index.html"));
      if (!isWithinRoot(file)) { res.writeHead(404).end("Not found"); return; }
      const data = await readFile(file);
      res.writeHead(200, { ...headers, "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": data.length });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) throw error;
      const data = await readFile(path.join(root, "404.html"));
      res.writeHead(404, { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Length": data.length });
      res.end(req.method === "HEAD" ? undefined : data);
    }
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Local preview error");
  }
});
server.on("error", (error) => { console.error(`Cannot start preview: ${error.message}`); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Local preview: http://127.0.0.1:${port} (Street map enabled; author Access / D1 require Cloudflare; Ctrl+C to stop)`));
