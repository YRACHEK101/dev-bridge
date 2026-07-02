// A tiny HTTP server used by integration/e2e tests. Spawned by portbridge, so it
// reads PORT (injected) and DUMMY_KIND (from the service's `env`) — no shell
// quoting, which keeps it identical across macOS/Linux/Windows.
const http = require("node:http");

const port = process.env.PORT;
const kind = process.env.DUMMY_KIND === "frontend" ? "frontend" : "backend";

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (kind === "frontend") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body>frontend app</body></html>");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ from: "backend", method: req.method, url: req.url, body }));
      }
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`${kind} listening on http://localhost:${port}`));
