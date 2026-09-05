"use strict";
// Single-URL machine console: MeshCentral-style tabs (Desktop / Terminal)
// behind one HTTPS origin. Serves an inline manager page and reverse-proxies the
// per-service daemons, so the whole machine lives at one address with no mixed
// content and no frame-busting headers.
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// Optional relay log: tee every console.log/error to a file so machine-side
// relay diagnostics are fetchable at /relaylog.
if (process.env.RELAY_LOG) {
  const logFile = process.env.RELAY_LOG;
  const tee = (orig) => (...args) => {
    try { fs.appendFileSync(logFile, new Date().toISOString() + " " + args.map(String).join(" ") + "\n"); } catch (_) {}
    return orig(...args);
  };
  console.log = tee(console.log);
  console.error = tee(console.error);
}

const PORT = Number(process.env.PORT || 8082);
const KIND = process.env.KIND || "machine";
const LABEL = process.env.LABEL || "GitHub Machine";
const USER = process.env.USER || "runner";
const PASS = process.env.PASS || "";
// Windows: enable the in-process RDCleanPath browser RDP client (ironrdp-wasm)
// on WebSocket root / and /rdp/relay, plus the /rdp/ viewer static files.
const RDP = (process.env.RDP || "0") === "1";
const RDP_USER = process.env.RDP_USER || "runneradmin";
const RDP_ADDR = process.env.RDP_ADDR || "";
const RDP_DIR = path.join(__dirname, "rdp");
// When set, /term is served by this process itself (no external terminal
// daemon needed): an upgrade to /term/ws spawns a shell and relays it over
// WebSocket. Used on Windows where the ttyd win32 binary is unreliable.
const BUILTIN_TERM = (process.env.BUILTIN_TERM || "0") === "1";
const TERM_SHELL = process.env.TERM_SHELL || "cmd.exe";
const TTYD_PORT = Number(process.env.TTYD_PORT || 8080);
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
      .split("{{RDPADDR}}").join(RDP_ADDR);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(out);
  });
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
    path: req.url,
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
  return null;
}

const TERM_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terminal</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0d0f12; color: #d7d7d0; }
  body { font: 13px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; padding: 10px 12px; }
  #out { white-space: pre-wrap; word-break: break-word; margin: 0 0 8px; }
  #line { display: flex; align-items: baseline; gap: 8px; }
  #prompt { color: #f0a944; user-select: none; }
  #inp { flex: 1; background: transparent; border: 0; outline: 0; color: #d7d7d0; font: inherit; }
  #err { color: #e07a5f; }
</style>
</head>
<body>
<div id="out"></div>
<div id="line"><span id="prompt">$ </span><input id="inp" autocomplete="off" autofocus spellcheck="false"></div>
<script>
(function () {
  var out = document.getElementById("out");
  var inp = document.getElementById("inp");
  var pending = "";
  function feed(t) {
    pending += t;
    var nl = pending.lastIndexOf("\\n");
    if (nl !== -1) { out.textContent += pending.slice(0, nl + 1); pending = pending.slice(nl + 1); window.scrollTo(0, document.body.scrollHeight); }
  }
  var ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/term/ws");
  ws.binaryType = "arraybuffer";
  ws.onopen = function () { feed("\\r\\n"); };
  ws.onmessage = function (e) { feed(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)); };
  ws.onclose = function () { out.textContent += "\\n[terminal closed]\\n"; inp.disabled = true; };
  ws.onerror = function () { out.textContent += "\\n[terminal error]\\n"; };
  inp.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var cmd = inp.value;
      inp.value = "";
      out.textContent += cmd + "\\r\\n";
      if (ws.readyState === 1) ws.send(cmd + "\\r\\n");
      e.preventDefault();
    }
  });
})();
</script>
</body>
</html>`;

function serveTermPage(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(TERM_PAGE);
}

function handleTermUpgrade(req, socket, head) {
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
  let child;
  try {
    child = spawn(TERM_SHELL, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } catch (e) {
    shim.close();
    return;
  }
  child.stdout.on("data", (d) => shim.send(d));
  child.stderr.on("data", (d) => shim.send(d));
  child.on("error", () => shim.close());
  child.on("close", () => shim.close());
  shim.on("message", (b) => {
    if (child && child.stdin.writable) child.stdin.write(b);
  });
  shim.on("close", () => {
    if (child) child.kill();
  });
  shim.on("error", () => {
    if (child) child.kill();
  });
  if (head && head.length) {
    try { shim._feed(Buffer.from(head)); } catch (_) {}
  }
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
    socket.on("data", (c) => this._feed(c));
    socket.on("error", () => this.emit("error"));
    socket.on("end", () => {
      if (this.readyState === 1) this.readyState = 3;
      this.emit("close");
    });
    this._feed = (chunk) => {
      this._buf = Buffer.concat([this._buf, chunk]);
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
    };
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
  shim.on("error", () => shim.close());
  try {
    require("./rdp/lib/rdp-proxy.js").handleConnection(shim);
  } catch (e) {
    shim.close();
  }
  if (head && head.length) {
    try { shim._feed(Buffer.from(head)); } catch (_) {}
  }
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
  if (u === "/relaylog" && process.env.RELAY_LOG) {
    fs.readFile(process.env.RELAY_LOG, (err, data) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(err ? "no relay log yet" : data);
    });
    return;
  }
  if (u.startsWith("/term")) {
    if (BUILTIN_TERM) return serveTermPage(res, u);
    return proxyWeb(req, res, TTYD_PORT);
  }
  if (RDP && u.startsWith("/rdp")) return serveRdpStatic(res, u.slice("/rdp".length).split("?")[0]);
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.on("upgrade", (req, socket, head) => {
  const url = (req.url || "").split("?")[0];
  if (RDP && (url === "/" || url === "/rdp/relay")) {
    return handleRdpUpgrade(req, socket, head);
  }
  if (BUILTIN_TERM && url === "/term/ws") {
    return handleTermUpgrade(req, socket, head);
  }
  const port = upgradeTarget((req.url || "").split("?")[0]);
  if (!port) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const client = net.connect(port, "127.0.0.1", () => {
    const headers = Object.assign({}, req.headers, { host: "127.0.0.1:" + port });
    let raw = req.method + " " + req.url + " HTTP/1.1\r\n";
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