"use strict";
// Single-URL machine console: MeshCentral-style tabs (Desktop / Terminal / Files)
// behind one HTTPS origin. Serves an inline manager page and reverse-proxies the
// per-service daemons, so the whole machine lives at one address with no mixed
// content and no frame-busting headers.
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

const PORT = Number(process.env.PORT || 8082);
const KIND = process.env.KIND || "machine";
const LABEL = process.env.LABEL || "GitHub Machine";
const USER = process.env.USER || "runner";
const PASS = process.env.PASS || "";
const VNC = (process.env.VNC || "1") === "1";
// Windows: enable the in-process RDCleanPath browser RDP client (ironrdp-wasm)
// on WebSocket root / and /rdp/relay, plus the /rdp/ viewer static files.
const RDP = (process.env.RDP || "0") === "1";
const RDP_USER = process.env.RDP_USER || "runneradmin";
const RDP_ADDR = process.env.RDP_ADDR || "";
const RDP_DIR = path.join(__dirname, "rdp");
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
  ".wasm": "application/wasm",
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
      .split("{{RDP}}").join(RDP ? "1" : "0")
      .split("{{RDP_USER}}").join(RDP_USER)
      .split("{{RDPADDR}}").join(RDP_ADDR)
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

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function wsAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

function wsFrame(opcode, payload) {
  const b1 = 0x80 | opcode;
  let header;
  if (payload.length < 126) header = Buffer.from([b1, payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function parseFrames(acc) {
  let rest = acc;
  const msgs = [];
  while (rest.length >= 2) {
    const b0 = rest[0];
    const b1 = rest[1];
    const fin = (b0 & 0x80) !== 0;
    const op = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) {
      if (rest.length < 4) break;
      len = rest.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (rest.length < 10) break;
      const big = rest.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
      len = Number(big);
      off = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (rest.length < off + maskLen + len) break;
    let payload = rest.slice(off + maskLen, off + maskLen + len);
    if (masked) {
      const mask = rest.slice(off, off + 4);
      payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    }
    rest = rest.slice(off + maskLen + len);
    if (!fin && (op === 0x1 || op === 0x2)) msgs.push({ type: "continuation-start", op, payload });
    else if (op === 0x8) msgs.push({ type: "close" });
    else if (op === 0x9) msgs.push({ type: "ping", payload });
    else if (op === 0x1 || op === 0x2) msgs.push({ type: "binary", payload });
  }
  return { msgs, rest };
}

class WsShim extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = 1;
    this._buf = Buffer.alloc(0);
    let partial = new Map();
    socket.on("data", (c) => {
      this._buf = Buffer.concat([this._buf, c]);
      const r = parseFrames(this._buf);
      this._buf = r.rest;
      for (const m of r.msgs) {
        if (this.readyState !== 1) continue;
        if (m.type === "close") {
          this.readyState = 3;
          try { this.socket.write(wsFrame(0x8, Buffer.alloc(0))); } catch (_) {}
          this.emit("close");
          this.socket.destroy();
          return;
        }
        if (m.type === "ping") {
          try { this.socket.write(wsFrame(0xa, m.payload)); } catch (_) {}
          continue;
        }
        if (m.type === "continuation-start") partial.set(m.op, m.payload);
        else if (m.type === "binary") {
          if (partial.size) {
            const full = Buffer.concat([partial.get(0x2) || Buffer.alloc(0), m.payload]);
            partial.delete(0x2);
            partial.delete(0x1);
            this.emit("message", full);
          } else {
            this.emit("message", m.payload);
          }
        }
      }
    });
    socket.on("error", () => this.emit("error"));
    socket.on("end", () => {
      if (this.readyState === 1) this.readyState = 3;
      this.emit("close");
    });
  }
  send(data) {
    if (this.readyState !== 1) return;
    try {
      this.socket.write(wsFrame(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data)));
    } catch (_) {}
  }
  close() {
    if (this.readyState === 1) {
      try { this.socket.write(wsFrame(0x8, Buffer.alloc(0))); } catch (_) {}
    }
    this.readyState = 3;
    this.socket.destroy();
  }
}

function handleRdpUpgrade(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
  );
  const shim = new WsShim(socket);
  try {
    require("./rdp/lib/rdp-proxy.js").handleConnection(shim);
  } catch (e) {
    shim.close();
  }
  if (head && head.length) shim._feed(Buffer.from(head));
}

function serveRdpStatic(res, rel) {
  const target = rel === "" || rel === "/" ? "index.html" : rel;
  const file = path.normalize(path.join(RDP_DIR, target));
  if (!file.startsWith(path.normalize(RDP_DIR))) {
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
  if (u.startsWith("/vnc/")) return serveStatic(res, u.slice("/vnc".length).split("?")[0]);
  if (RDP && u.startsWith("/rdp")) return serveRdpStatic(res, u.slice("/rdp".length).split("?")[0]);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (req, socket, head) => {
  const url = (req.url || "").split("?")[0];
  if (RDP && (url === "/" || url === "/rdp/relay")) {
    return handleRdpUpgrade(req, socket, head);
  }
  const port = upgradeTarget((req.url || "").split("?")[0]);
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