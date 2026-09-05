// Machine Launcher — load the rest of the UI wiring in main.js
"use strict";

const MACHINES = {
  ubuntu: { name: "Ubuntu", workflow: ".github/workflows/Ubuntu.yml", osClass: "ubuntu" },
  windows: { name: "Windows", workflow: ".github/workflows/Windows-latest.yml", osClass: "windows" },
  macos: { name: "macOS", workflow: ".github/workflows/macOS.yml", osClass: "macos" },
};

const PORTALS = [
  { key: "MAROHUB_TERMINAL", label: "Terminal" },
  { key: "MAROHUB_FILES", label: "Files" },
  { key: "MAROHUB_DESKTOP", label: "Desktop" },
  { key: "MAROHUB_RDP", label: "RDP" },
];

const LIFETIME_MS = 6 * 60 * 60 * 1000; // ~6h bore relay window
const LS_CONFIG = "machine-launcher-config";
const LS_SESSIONS = "machine-launcher-sessions";
let debugOpen = false; // set from main.js (debug toggle)

/* ---------------------------------- state --------------------------------- */

let sessionGen = 1;
const config = loadConfig();
const sessions = loadSessions();
Object.keys(MACHINES).forEach((k) => {
  if (!sessions[k] || typeof sessions[k] !== "object") sessions[k] = freshSession();
});
persistSessions();

function freshSession() {
  return {
    gen: sessionGen++,
    runId: null,
    createdAt: Date.now(),
    status: "idle",
    step: "",
    htmlUrl: "",
    endpoints: {},
    bootedAt: null,
    error: "",
    note: "",
  };
}
function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (raw) return Object.assign(defaultConfig(), JSON.parse(raw));
  } catch (_) {}
  return defaultConfig();
}
function defaultConfig() {
  return { repo: "ammar0xff/GitHub_Machines", token: "", password: "P@ssw0rd!123" };
}
function persistConfig() {
  localStorage.setItem(LS_CONFIG, JSON.stringify(config));
}
function loadSessions() {
  try {
    const raw = localStorage.getItem(LS_SESSIONS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {};
}
function persistSessions() {
  localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
}

function owner() {
  const parts = config.repo.replace(/[\/\s]+$/, "").split("/");
  return { owner: parts[0], repo: parts[1] };
}

/* ---------------------------------- util ---------------------------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]),
  );
}
function mmss(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
}

/* -------------------------------- github api ------------------------------ */

function gh(path, method, body) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (config.token) headers.Authorization = "Bearer " + config.token;
  const opts = { method: method || "GET", headers };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  return fetch("https://api.github.com" + path, opts).then((r) => {
    if (r.status === 404) throw new Error("Not found on GitHub (404)");
    if (r.status === 401 || r.status === 403) throw new Error("Auth needed: add a token in Settings");
    if (!r.ok) throw new Error("GitHub " + r.status);
    return r.json().catch(() => ({}));
  });
}

function api() {
  const o = owner();
  const own = o.owner;
  const rep = o.repo;
  return {
    own,
    rep,
    workflowInfo(kind) {
      return gh("/repos/" + own + "/" + rep + "/contents/" + MACHINES[kind].workflow);
    },
    dispatch(kind) {
      // repository_dispatch works for anonymous + token; workflows listen on both
      return gh("/repos/" + own + "/" + rep + "/dispatches", "POST", {
        event_type: "machine-" + kind,
        client_payload: { machine: kind },
      });
    },
    runs() {
      // pull both dispatch event types; match by workflow name + time client-side
      return gh("/repos/" + own + "/" + rep + "/actions/runs?per_page=100").then((j) => j.workflow_runs || []);
    },
    logs(runId) {
      return fetch("https://api.github.com/repos/" + own + "/" + rep + "/actions/runs/" + runId + "/logs", {
        headers: {
          Accept: "application/vnd.github+json",
          ...(config.token ? { Authorization: "Bearer " + config.token } : {}),
        },
      }).then((r) => {
        if (r.status === 403 || r.status === 401) throw new Error("logs-auth");
        if (!r.ok) throw new Error("logs-" + r.status);
        return r.text();
      });
    },
    cancel(runId) {
      return gh("/repos/" + own + "/" + rep + "/actions/runs/" + runId + "/cancel", "POST");
    },
  };
}

/* ------------------------------ run lifecycle ----------------------------- */

const ACTIVE_STATUSES = ["launching", "queued", "running", "requested", "preparing", "waiting", "started"];
function isActive(s) {
  return ACTIVE_STATUSES.includes(s.status);
}

function isTargetEvent(run) {
  return run.event === "workflow_dispatch" || run.event === "repository_dispatch";
}
function findOurRun(runs, kind, sinceMs) {
  const name = MACHINES[kind].name;
  const matches = (runs || []).filter(
    (r) => r.name === name && isTargetEvent(r) && new Date(r.created_at).getTime() >= sinceMs - 3000,
  );
  matches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return matches[0] || null;
}

async function startMachine(kind) {
  const s = sessions[kind];
  if (isActive(s)) return;
  if (!config.token) {
    Object.assign(s, freshSession(), {
      status: "error",
      createdAt: Date.now(),
      error: "Add a GitHub token in Settings. The machine can’t be launched or tracked without one.",
    });
    persistSessions();
    renderAll();
    return;
  }

  Object.assign(s, freshSession(), { createdAt: Date.now(), status: "launching" });
  persistSessions();
  renderAll();

  const a = api();
  try {
    await a.workflowInfo(kind); // fail fast on missing workflow
    await a.dispatch(kind);
  } catch (err) {
    s.status = "error";
    s.error = dispatchErr(err);
    persistSessions();
    renderAll();
    return;
  }

  // find the run we just created
  let found = false;
  for (let i = 0; i < 30 && !found; i++) {
    await sleep(3000);
    try {
      const run = findOurRun(await a.runs(), kind, s.createdAt);
      if (run) {
        s.runId = String(run.id);
        s.htmlUrl = run.html_url || "";
        s.status = run.status === "in_progress" ? "running" : ACTIVE_STATUSES.includes(run.status) ? "queued" : run.status;
        found = true;
      }
    } catch (_) {}
  }
  if (!found) {
    s.status = "running"; // assume it started; poller will reconcile
    persistSessions();
  }

  poller(kind); // fire-and-forget: reconciles until completion
}

function dispatchErr(err) {
  const m = (err && err.message) || "unknown error";
  if (m.includes("Not found")) return "Workflow file not found in " + config.repo;
  return m;
}

async function poller(kind) {
  const myGen = sessions[kind].gen;
  const a = api();
  const tick = (window && window.__MACHINE_POLL_TICK) || 6000; // testable/profiling hook
  const budget = Math.ceil((LIFETIME_MS * 1.05) / tick) + 5; // watch for ~6h
  let sinceLog = 0;
  for (let i = 0; i < budget; i++) {
    const s = sessions[kind];
    if (!s || s.gen !== myGen) return; // superseded or reset
    if (s.status === "idle" || s.status === "ended" || s.status === "error") return; // terminal
    await sleep(tick);

    let r;
    try {
      if (!s.runId) {
        // dispatch hasn't surfaced a run yet; reconcile via newest matching run
        r = findOurRun(await a.runs(), kind, s.createdAt);
        if (r) {
          s.runId = String(r.id);
          s.htmlUrl = r.html_url || "";
        }
      } else {
        const runs = await a.runs();
        r = runs.find((x) => String(x.id) === String(s.runId));
      }
    } catch (_) {
      continue;
    }
    if (!r) continue;

    if (r.status === "completed") {
      const wasReady = Object.keys(s.endpoints).length > 0;
      if (wasReady) {
        s.status = "ended";
        s.error = "Machine ended: " + (r.conclusion || "stopped") + ". View run ↗";
      } else {
        s.status = "ended";
        s.error = "Run " + (r.conclusion || "ended") + " before the machine could be used.";
      }
      persistSessions();
      renderAll();
      return;
    }

    if (r.status === "in_progress") {
      if (s.status !== "running" && !Object.keys(s.endpoints).length) {
        s.status = "running";
        persistSessions();
        renderAll();
      }
      if (!Object.keys(s.endpoints).length && i >= sinceLog) {
        // fetch logs until the tunnel endpoints appear
        sinceLog = i + (config.token ? 2 : 2); // every ~12s / ~80s
        let logs;
        try {
          logs = await a.logs(s.runId);
        } catch (e) {
          const tokenIssue = String((e && e.message) || "") === "logs-auth";
          if (tokenIssue && !s.note) {
            s.note = "Your token can’t read run logs. It needs Actions: Read access in Settings.";
            persistSessions();
            renderAll();
          }
          continue;
        }
        const found = parseEndpoints(logs);
        if (Object.keys(found).length) {
          Object.assign(s.endpoints, found);
          s.bootedAt = Date.now();
          s.status = "ready";
          persistSessions();
          renderAll();
        }
      }
    } else {
      if (s.status !== "queued") {
        s.status = "queued";
        persistSessions();
        renderAll();
      }
    }
  }
  // watcher budget exhausted
  if (sessions[kind]) {
    const s = sessions[kind];
    if (s.gen === myGen && isActive(s)) {
      s.status = "error";
      s.error = "Lost contact with the run; it may still be alive on GitHub.";
      persistSessions();
      renderAll();
    }
  }
}

function parseEndpoints(logText) {
  const out = {};
  const lines = String(logText || "").split("\n");
  for (const line of lines) {
    if (!line.includes("MAROHUB_")) continue;
    for (const p of PORTALS) {
      if (!line.includes(p.key)) continue;
      const http = line.match(/https?:\/\/[A-Za-z0-9._-]+:\d+[^\s"']*/);
      const bare = http ? null : line.match(/\b[A-Za-z0-9._-]+:\d{2,5}\b/);
      const m = http || bare;
      if (m && !out[p.key]) out[p.key] = m[0];
    }
  }
  return out;
}

async function stopMachine(kind) {
  const s = sessions[kind];
  const runId = s.runId;
  Object.assign(s, freshSession());
  persistSessions();
  renderAll();
  if (runId) {
    try {
      await api().cancel(runId);
    } catch (_) {}
  }
}

/* ---------------------------------- render -------------------------------- */

function statusText(kind, s) {
  if (s.status === "ready") return "Ready: pick a portal below";
  if (s.status === "idle") return "Tap Launch for a fresh machine";
  if (s.status === "launching") return "Launching…";
  if (s.status === "queued") return "Queued: prep underway";
  if (s.status === "running") return s.runId ? "Running · #" + s.runId : "Running…";
  if (s.status === "success" || s.status === "ready") return "Ready";
  if (s.status === "ended") return "Machine ended";
  if (s.status === "completed") return "Run finished";
  if (s.status === "error") return s.error;
  return s.status;
}

function bootTimerMs(s) {
  if (!s) return 0;
  return Date.now() - (s.bootedAt || s.createdAt || Date.now());
}

function updateRunningTimers() {
  for (const kind of Object.keys(MACHINES)) {
    const s = sessions[kind];
    if (!isActive(s)) continue;
    const t = document.getElementById("timer-" + kind);
    if (t) t.textContent = mmss(bootTimerMs(s));
  }
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  if (ta.select) ta.select();
  try {
    if (document.execCommand) document.execCommand("copy");
  } catch (_) {}
  if (ta.remove) ta.remove();
  else document.body.removeChild(ta);
}

function portalButtons(kind, s) {
  return PORTALS.map((p) => {
    const url = s.endpoints[p.key];
    const isHttp = /^https?:\/\//.test(url || "");
    const tile = el("div", { className: "portal" + (url ? "" : " muted") });
    tile.appendChild(el("span", { className: "portal-label" }, p.label));
    if (url) {
      tile.appendChild(el("code", { className: "portal-url" }, url.replace(/^https?:\/\//, "")));
      if (isHttp) {
        tile.appendChild(el("a", {
          className: "portal-open",
          href: url,
          target: "_blank",
          rel: "noopener",
          title: "Open " + p.label + " in a new tab",
        }, "open"));
      }
      const copy = el("button", {
        className: "portal-copy" + (isHttp ? "" : " wide"),
        title: "Copy " + p.label + " address",
      }, isHttp ? "copy" : "copy addr");
      copy.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyText(url);
      });
      tile.appendChild(copy);
    } else {
      tile.appendChild(el("span", { className: "portal-na" }, "n/a"));
    }
    return tile;
  });
}

function renderAll() {
  Object.keys(MACHINES).forEach(renderCard);
}

function renderCard(kind) {
  const root = document.getElementById("machines");
  const s = sessions[kind];
  const spec = MACHINES[kind];

  const status = statusText(kind, s);

  const card = root.querySelector('[data-kind="' + kind + '"]');
  card.innerHTML = "";

  card.appendChild(el("div", { className: "card-head" }, [
    el("span", { className: "os-dot " + spec.osClass }),
    el("h3", { className: "os-name" }, spec.name),
    el("span", { className: "card-state " + stateClass(s) }, stateLabel(s)),
  ]));

  const live = el("p", { className: "status", role: "status", "aria-live": "polite" });
  const liveText = el("span", {}, status);
  live.appendChild(liveText);
  if (s.status === "running" || s.status === "launching") {
    const timer = el("span", { id: "timer-" + kind, className: "timer", "aria-hidden": "true" });
    timer.textContent = mmss(bootTimerMs(s));
    live.appendChild(document.createTextNode(" · "));
    live.appendChild(timer);
  }
  card.appendChild(live);

  const body = el("div", { className: "card-body" });
  if (s.note && (isActive(s) || s.status === "ready")) {
    body.appendChild(el("p", { className: "note-line", role: "note" }, s.note));
  }

  if (s.status === "ready" && Object.keys(s.endpoints).length) {
    body.appendChild(el("div", { className: "portals" }, portalButtons(kind, s)));
    body.appendChild(el("p", { className: "lifetime" }, "This machine stops at " + lifetimeUntil(s) + " or when the run ends"));
    body.appendChild(primaryBtn(kind, "Stop machine", "stop", () => stopMachine(kind)));
  } else if (isActive(s) || s.status === "completed") {
    body.appendChild(el("div", { className: "minirow" }, [
      el("code", { className: "run-id" }, s.runId ? "#" + s.runId : "-"),
      el("a", {
        className: "btn ghost",
        href: s.htmlUrl || "#",
        target: "_blank",
        rel: "noopener",
      }, "View run ↗"),
      primaryBtn(kind, "Abort", "stop", () => stopMachine(kind)),
    ]));
  } else if (s.status === "ended" || s.status === "error") {
    body.appendChild(el("p", { className: "errline" }, s.error || "That run ended."));
    body.appendChild(el("div", { className: "minirow" }, [
      s.htmlUrl ? el("a", {
        className: "btn ghost",
        href: s.htmlUrl,
        target: "_blank",
        rel: "noopener",
      }, "View run ↗") : null,
      primaryBtn(kind, "Launch again", "primary", () => startMachine(kind)),
    ]));
  } else {
    body.appendChild(primaryBtn(kind, "Launch " + spec.name, "primary", () => startMachine(kind)));
  }

  if (debugOpen) {
    const detail = el("pre", { className: "debug" }, JSON.stringify(s, null, 2));
    body.appendChild(detail);
  }

  card.appendChild(body);
}

function stateClass(s) {
  if (s.status === "ready") return "ok";
  if (isActive(s) || s.status === "completed") return "busy";
  if (s.status === "ended" || s.status === "error") return "bad";
  return "idle";
}
function stateLabel(s) {
  if (s.status === "ready") return "READY";
  if (s.status === "running") return "RUNNING";
  if (s.status === "queued") return "QUEUED";
  if (s.status === "launching") return "STARTING";
  if (s.status === "ended") return "ENDED";
  if (s.status === "error") return "ERROR";
  if (s.status === "completed") return "DONE";
  return "IDLE";
}
function lifetimeUntil(s) {
  const end = new Date((s.bootedAt || Date.now()) + LIFETIME_MS);
  return end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function primaryBtn(kind, label, style, fn) {
  const b = el("button", { className: "btn " + style });
  b.appendChild(document.createTextNode(label));
  b.addEventListener("click", fn);
  return b;
}

function el(tag, props = {}, children = null) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "className") e.className = v;
    else if (k.startsWith("on")) e[k] = v;
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  if (children != null) {
    const arr = Array.isArray(children) ? children : [children];
    for (const c of arr) if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}