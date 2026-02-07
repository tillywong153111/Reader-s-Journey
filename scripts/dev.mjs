import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const root = resolve(process.cwd(), "src");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wav": "audio/wav"
};

function resolveRequestPath(urlValue) {
  const parsed = new URL(urlValue || "/", `http://${host}:${port}`);
  const pathname = decodeURIComponent(parsed.pathname || "/");
  if (pathname === "/" || pathname === "") {
    return "/index.html";
  }
  if (pathname.endsWith("/")) {
    return `${pathname}index.html`;
  }
  return pathname;
}

const server = createServer((req, res) => {
  const requestPath = resolveRequestPath(req.url);
  const filePath = resolve(root, `.${requestPath}`);
  const ext = extname(filePath);

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const data = readFileSync(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(data);
});

server.listen(port, host, () => {
  console.log(`Dev server running at http://${host}:${port}`);
});
