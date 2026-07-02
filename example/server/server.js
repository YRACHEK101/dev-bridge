// Minimal dependency-free "backend" — an in-memory todos API.
// portbridge routes /api/* here (see ../portbridge.config.json).
const http = require("node:http");

const PORT = process.env.PORT || 5000;

let todos = [
  { id: 1, title: "Run both servers with one command", done: true },
  { id: 2, title: "Call /api with no CORS setup", done: false },
  { id: 3, title: "Watch requests in the dashboard", done: false },
];
let nextId = 4;

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function route(req, res, body) {
  const { method, url } = req;

  if (url === "/api/health") return send(res, 200, { ok: true });

  if (url === "/api/todos" && method === "GET") return send(res, 200, todos);

  if (url === "/api/todos" && method === "POST") {
    let title = "Untitled";
    try {
      const parsed = JSON.parse(body || "{}");
      if (parsed.title) title = String(parsed.title);
    } catch {
      /* keep default */
    }
    const todo = { id: nextId++, title, done: false };
    todos.push(todo);
    return send(res, 201, todo);
  }

  return send(res, 404, { error: `no route for ${method} ${url}` });
}

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      // A little jitter so the dashboard's duration bars are interesting.
      const delay = 20 + Math.floor(Math.random() * 120);
      setTimeout(() => route(req, res, body), delay);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`api listening on http://localhost:${PORT}`));
