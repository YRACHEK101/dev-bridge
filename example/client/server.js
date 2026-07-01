// Minimal dependency-free "frontend" dev server. It serves the single page for
// every request; dev-bridge only forwards non-/api paths here.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = process.env.PORT || 5173;
const page = fs.readFileSync(path.join(__dirname, "index.html"));

http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`frontend listening on http://localhost:${PORT}`));
