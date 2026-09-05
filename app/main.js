"use strict";

/* ------------------------------- element refs ------------------------------ */

function $(id) {
  return document.getElementById(id);
}

/* --------------------------------- header ---------------------------------- */

function refreshHeader() {
  const chip = $("repo-chip");
  if (chip) chip.textContent = config.repo || "owner/repo";
  const reposs = $("settings-repo");
  if (reposs) reposs.value = config.repo;
}

/* --------------------------------- settings -------------------------------- */

let settingsOpen = false;

function openSettings() {
  settingsOpen = true;
  const sheet = $("settings");
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  $("overlay").classList.remove("hidden");
  $("set-repo").value = config.repo || "";
  $("set-token").value = config.token || "";
  $("set-password").value = config.password || "";
  $("set-debug").checked = debugOpen;
  $("set-repo").focus();
}
function closeSettings() {
  settingsOpen = false;
  const sheet = $("settings");
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  $("overlay").classList.add("hidden");
}
function saveSettings() {
  config.repo = $("set-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
  config.token = $("set-token").value.trim();
  config.password = $("set-password").value.trim() || "P@ssw0rd!123";
  debugOpen = $("set-debug").checked;
  persistConfig();
  refreshHeader();
  renderAll();
  closeSettings();
}
function clearSessions() {
  Object.keys(MACHINES).forEach((k) => {
    sessions[k] = freshSession();
  });
  persistSessions();
  renderAll();
  flashSave("Saved machines cleared");
}

let flashTimer = null;
function flashSave(msg) {
  const el = $("save-note");
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (el.textContent = ""), 2500);
}

function wireSettings() {
  $("settings-btn").addEventListener("click", openSettings);
  $("sheet-close").addEventListener("click", closeSettings);
  $("overlay").addEventListener("click", closeSettings);
  $("sheet-save").addEventListener("click", () => {
    saveSettings();
    flashSave("Saved");
  });
  $("sheet-drop").addEventListener("click", clearSessions);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsOpen) closeSettings();
  });
}

/* ------------------------------ boundary clock ------------------------------ */

setInterval(updateRunningTimers, 1000);

/* ------------------------------ service worker ------------------------------ */

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------------------------------- boot ----------------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  $("machines").innerHTML = "";
  Object.keys(MACHINES).forEach((k) => {
    $("machines").appendChild(el("section", { className: "card", "data-kind": k, "aria-label": MACHINES[k].name + " machine" }));
  });
  refreshHeader();
  wireSettings();
  renderAll();
  Object.keys(MACHINES).forEach((k) => {
    const s = sessions[k];
    const needsWatcher =
      ACTIVE_STATUSES.includes(s.status) || (s.status === "ready" && s.runId);
    if (needsWatcher) poller(k);
  });
});