"use strict";
// Single-URL machine console: MeshCentral-style tabs (Desktop / Terminal / Files)
// behind one HTTPS origin. Serves an inline manager page and reverse-proxies the
// per-service daemons, so the whole machine lives at one address with no mixed
// content and no frame-busting headers.
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8082);
const KIND = process.env.KIND || "machine";
const LABEL = process.env.LABEL || "GitHub Machine";
const USER = process.env.USER || "runner";
const PASS = process.env.PASS || "";
const RDP = process.env.RDP || "";
const VNC = (process.env.VNC || "1") === "1";
// macOS uses gotty (no -b flag) — strip the /term prefix on its way through so its
// client (which builds WS from location.pathname) keeps working at /term/ws.
const TERM_STRIP = (process.env.TERM_STRIP || "0") === "1";
const NOVNC_DIR = process.env.NOVNC || "/usr/share/novnc";
const TTYD_PORT = Number(process.env.TTYD_PORT || 8080);
const FB_PORT = Number(process.env.FB_PORT || 8081);
const WS_PORT = Number(process.env.VNCWS_PORT || 6080);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveConsole(res) {
  fs.readFile(path.join(ROOT, "index.html"), "utf8", (err, html) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("console page missing");
      return;
    }
    const out = html
      .split("{{KIND}}").join(KIND)
      .split("{{LABEL}}").join(LABEL)
      .split("{{USER}}").join(USER)
      .split("{{PASS}}").join(PASS)
      .split("{{RDP}}").join(RDP)
      .split("{{VNC}}").join(VNC ? "1" : "0");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(out);
  });
}

function serveStatic(res, rel) {
  const file = path.normalize(path.join(NOVNC_DIR, rel));
  if (!file.startsWith(path.normalize(NOVNC_DIR))) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    const mime = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(data);
  });
}

function termPath(url) {
  if (!TERM_STRIP) return url;
  const q = url.indexOf("?") === -1 ? "" : url.slice(url.indexOf("?"));
  const p = url.indexOf("?") === -1 ? url : url.slice(0, url.indexOf("?"));
  const stripped = p === "/term" ? "/" : p.replace(/^\/term/, "") || "/";
  return stripped + q;
}

function proxyWeb(req, res, port) {
  const headers = Object.assign({}, req.headers, {
    host: "127.0.0.1:" + port,
    "x-forwarded-proto": "https",
    "x-forwarded-host": req.headers.host || "localhost",
    connection: "close",
  });
  delete headers["x-forwarded-for"];
  const upstream = http.request({
    host: "127.0.0.1",
    port,
    path: port === TTYD_PORT ? termPath(req.url) : req.url,
    method: req.method,
    headers,
  }, (upres) => {
    delete upres.headers["x-frame-options"];
    delete upres.headers["content-security-policy"];
    res.writeHead(upres.statusCode, upres.headers);
    upres.pipe(res);
  });
  upstream.on("error", () => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("upstream unavailable");
  });
  req.pipe(upstream);
}

function upgradeTarget(url) {
  if (url.startsWith("/term")) return TTYD_PORT;
  if (url.startsWith("/files")) return FB_PORT;
  if (url.startsWith("/vnc-websockify")) return WS_PORT;
  return null;
}

const server = http.createServer((req, res) => {
  const u = req.url || "/";
  if (u === "/" || u === "/index.html") return serveConsole(res);
  if (u === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (u.startsWith("/term")) return proxyWeb(req, res, TTYD_PORT);
  if (u.startsWith("/files")) return proxyWeb(req, res, FB_PORT);
  if (u.startsWith("/vnc-websockify")) return proxyWeb(req, res, WS_PORT);
  if (u.startsWith("/vnc/")) return serveStatic(res, u.slice("/vnc".length));
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (req, socket, head) => {
  const port = upgradeTarget(req.url || "");
  if (!port) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const client = net.connect(port, "127.0.0.1", () => {
    const headers = Object.assign({}, req.headers, { host: "127.0.0.1:" + port });
    const pathToForward = port === TTYD_PORT ? termPath(req.url) : req.url;
    let raw = req.method + " " + pathToForward + " HTTP/1.1\r\n";
    for (const k of Object.keys(headers)) raw += k + ": " + String(headers[k]) + "\r\n";
    raw += "\r\n";
    client.write(Buffer.concat([Buffer.from(raw), head && head.length ? head : Buffer.alloc(0)]));
  });
  let buffered = null;
  const fwd = (chunk) => {
    if (buffered === null) {
      socket.write(chunk);
      return;
    }
    buffered = Buffer.concat([buffered, chunk]);
    const idx = buffered.indexOf("\r\n\r\n");
    if (idx === -1) return;
    socket.write(buffered);
    buffered = null;
    client.removeListener("data", fwd);
    client.pipe(socket);
  };
  client.on("data", fwd);
  socket.on("error", () => client.destroy());
  client.on("error", () => socket.destroy());
  socket.pipe(client);
});

server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("machine-console listening on 127.0.0.1:" + PORT);
});