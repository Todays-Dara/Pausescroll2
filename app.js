/* ============================================================
   PauseScroll — app.js
   A small versioned store in localStorage plus a UI that
   re-renders only from state changes. Timers store an absolute
   end timestamp so they survive a page refresh.
   ============================================================ */

const RING_CIRCUMFERENCE = 552.92;
const SEC = 1000;
const MIN = 60 * SEC;
const MAX_SNOOZES_PER_DAY = 3;
const STORE_KEY = "ps_state_v1";

/** Preset apps the timer can be aimed at. */
const APPS = [
  { id: "instagram", name: "Instagram", mark: "IG", color: "#E4405F", fg: "#ffffff" },
  { id: "tiktok", name: "TikTok", mark: "TT", color: "#1f2933", fg: "#ffffff" },
  { id: "x", name: "X", mark: "X", color: "#0f1419", fg: "#ffffff" },
  { id: "facebook", name: "Facebook", mark: "fb", color: "#1877F2", fg: "#ffffff" },
  { id: "youtube", name: "YouTube", mark: "YT", color: "#FF0000", fg: "#ffffff" },
  { id: "snapchat", name: "Snapchat", mark: "s", color: "#FFFC00", fg: "#0f1419" },
  { id: "reddit", name: "Reddit", mark: "R", color: "#FF4500", fg: "#ffffff" },
  { id: "threads", name: "Threads", mark: "@", color: "#0f1419", fg: "#ffffff" },
];

const MINUTE_PRESETS = [5, 10, 15, 30, 60];

/** Returns a local calendar-day key like "2026-09-21". */
function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses "HH:MM" into minutes since midnight. */
function timeToMinutes(value) {
  const [h, m] = value.split(":").map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** True when `now` falls inside a (possibly overnight) quiet-hours window. */
function inQuietWindow(start, end, now = new Date()) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  if (startMin <= endMin) return nowMin >= startMin && nowMin <= endMin;
  return nowMin >= startMin || nowMin <= endMin;
}

/* ============================================================
   Store
   ============================================================ */

/** Builds a fresh default state object. */
function defaultState() {
  const limits = {};
  APPS.forEach((app) => {
    limits[app.id] = 60;
  });
  return {
    v: 1,
    intent: "",
    appId: "instagram",
    minutes: 10,
    limits,
    quietHours: { enabled: false, start: "22:00", end: "06:00" },
    strict: false,
    active: null,
    sessions: [],
  };
}

/** Loads the persisted state, ignoring unknown schema versions. */
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return defaultState();
    return { ...defaultState(), ...parsed, quietHours: { ...defaultState().quietHours, ...(parsed.quietHours || {}) } };
  } catch {
    return defaultState();
  }
}

/**
 * The PauseScroll store. A single object of plain data with
 * named mutators; every mutation persists and notifies subscribers.
 */
function createStore() {
  const state = loadState();

  /** Prunes session history older than 14 days. */
  function pruneHistory() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 13);
    const cutoffKey = todayKey(cutoff);
    state.sessions = state.sessions.filter((s) => s.date >= cutoffKey);
  }

  pruneHistory();

  /** Serialises and persists the current state. */
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* Storage full or blocked — the app keeps working in memory. */
    }
  }

  const listeners = new Set();

  /** Runs `fn` on every state change. Returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** Notifies all subscribers that state changed. */
  function emit() {
    listeners.forEach((fn) => fn());
  }

  /** Persists and notifies after any mutation. */
  function commit() {
    persist();
    emit();
  }

  /** Returns the live state object. */
  function getState() {
    return state;
  }

  /** Number of snoozes already used today. */
  function snoozesToday() {
    const today = todayKey();
    return state.sessions.filter((s) => s.date === today && s.snoozed).length;
  }

  /** Records the active session into history, then clears it. */
  function recordAndClear() {
    const active = state.active;
    if (!active) return;
    state.sessions.push({
      date: todayKey(),
      appId: active.appId,
      intent: active.intent,
      minutes: active.minutes,
      mode: active.manual ? "manual" : "limit",
      snoozed: Boolean(active.snoozed),
    });
    pruneHistory();
    state.active = null;
  }

  /** Sets the intent text shown on a new session. */
  function setIntent(intent) {
    state.intent = (intent || "").slice(0, 120);
    commit();
  }

  /** Picks which preset app the next session targets. */
  function setApp(appId) {
    if (!APPS.some((a) => a.id === appId)) return;
    state.appId = appId;
    commit();
  }

  /** Sets the session length in minutes (clamped to 1–180). */
  function setLimit(minutes) {
    const n = Math.round(Number(minutes));
    state.minutes = Number.isFinite(n) ? Math.min(180, Math.max(1, n)) : 10;
    commit();
  }

  /** Applies a per-app daily limit in minutes. */
  function setAppLimit(appId, minutes) {
    if (!(appId in state.limits)) return;
    const n = Math.round(Number(minutes));
    state.limits[appId] = Number.isFinite(n) ? Math.min(240, Math.max(0, n)) : 0;
    commit();
  }

  /** Configures quiet hours. */
  function setQuietHours(quietHours) {
    state.quietHours = {
      enabled: Boolean(quietHours.enabled),
      start: quietHours.start || "22:00",
      end: quietHours.end || "06:00",
    };
    commit();
  }

  /** Turns strict mode on or off (removes snooze controls). */
  function setStrict(strict) {
    state.strict = Boolean(strict);
    commit();
  }

  /** Starts a session using the current intent/app/minute settings. */
  function startSession() {
    if (state.active) return;
    const now = Date.now();
    const total = state.minutes * MIN;
    state.active = {
      id: now.toString(36),
      startTs: now,
      endTs: now + total,
      totalMs: total,
      appId: state.appId,
      intent: state.intent,
      minutes: state.minutes,
      nudgeShown: false,
      answered: false,
      overlaid: false,
      snoozed: false,
      manual: false,
    };
    commit();
  }

  /** Flags the 80% nudge as shown for the current session. */
  function nudgeShown() {
    if (!state.active || state.active.nudgeShown) return;
    state.active.nudgeShown = true;
    commit();
  }

  /** Marks the session "time's up" so the overlay can appear. */
  function markOverlaid() {
    if (!state.active || state.active.overlaid) return;
    state.active.overlaid = true;
    commit();
  }

  /** Nudge answer: "I'm good" — acknowledges the nudge and keeps running. */
  function goodToGo() {
    if (!state.active) return;
    state.active.answered = true;
    commit();
  }

  /** Nudge answer: "One more minute" — adds one minute, once. */
  function oneMoreMinute() {
    if (!state.active || state.active.oneMore) return;
    state.active.oneMore = true;
    state.active.answered = true;
    state.active.endTs += MIN;
    commit();
  }

  /** Overlay button: grants five extra minutes, up to MAX_SNOOZES_PER_DAY. */
  function snooze() {
    if (!state.active || state.active.overlaid !== true) return;
    if (state.strict) return;
    if (snoozesToday() >= MAX_SNOOZES_PER_DAY) return;
    if (state.active.snoozed) return;
    state.active.snoozed = true;
    state.active.endTs += 5 * MIN;
    state.active.nudgeShown = false;
    state.active.answered = false;
    state.active.overlaid = false;
    commit();
  }

  /** Overlay button: accepts the end and closes the session at its limit. */
  function takeBreak() {
    if (!state.active) return;
    state.active.overlaid = true;
    recordAndClear();
    commit();
  }

  /** Ends the running session immediately (any mode). */
  function endSession() {
    if (!state.active) return;
    state.active.manual = true;
    recordAndClear();
    commit();
  }

  /** Removes today's session history (used by "reset today"). */
  function resetDay() {
    const today = todayKey();
    state.sessions = state.sessions.filter((s) => s.date !== today);
    commit();
  }

  /** Wipes everything back to first-run defaults. */
  function resetAll() {
    const fresh = defaultState();
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, fresh);
    commit();
  }

  /** Returns the full state as an indented JSON string. */
  function exportData() {
    return JSON.stringify(state, null, 2);
  }

  return {
    subscribe,
    getState,
    setIntent,
    setApp,
    setLimit,
    setAppLimit,
    setQuietHours,
    setStrict,
    startSession,
    nudgeShown,
    markOverlaid,
    goodToGo,
    oneMoreMinute,
    snooze,
    takeBreak,
    endSession,
    resetDay,
    resetAll,
    exportData,
    snoozesToday,
  };
}

const store = createStore();

/* ============================================================
   Helpers
   ============================================================ */

const $ = (id) => document.getElementById(id);

/** Formats milliseconds as m:ss. */
function formatMs(ms) {
  const total = Math.max(0, ms) / SEC;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return m + ":" + String(s).padStart(2, "0");
}

/** Reads the persisted theme or falls back to the OS preference. */
function currentTheme() {
  const stored = localStorage.getItem("ps_theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies a theme to the document and stores it. */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("ps_theme", theme);
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============================================================
   Theme + theme toggle
   ============================================================ */

/** Wires the theme toggle and the Settings theme selector. */
function initTheme() {
  applyTheme(currentTheme());
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    render();
  });
  document.querySelectorAll("[data-theme-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeOption);
      render();
    });
  });
}

/* ============================================================
   Views / tabs
   ============================================================ */

const TABS = ["timer", "apps", "stats", "settings"];
let activeTab = "timer";

/** Switches the visible view + tab button. */
function showTab(tab) {
  activeTab = tab;
  TABS.forEach((name) => {
    const view = $("view-" + name);
    const btn = document.querySelector(`.tabbtn[data-tab="${name}"]`);
    if (name === tab) {
      view.hidden = false;
      btn.setAttribute("aria-current", "page");
    } else {
      view.hidden = true;
      btn.removeAttribute("aria-current");
    }
  });
}

/** Wires the bottom tab bar. */
function initTabs() {
  document.querySelectorAll(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
}

/* ============================================================
   Timer render (ring, nudge, overlay)
   ============================================================ */

let ticker = null;

/** Cancels the animation ticker, if running. */
function stopTicker() {
  if (ticker) {
    cancelAnimationFrame(ticker);
    ticker = null;
  }
}

/** One animation step: updates the ring and resolves boundary events. */
function tick() {
  ticker = null;
  const s = store.getState();
  if (!s.active || s.active.overlaid) {
    renderTimer();
    return;
  }
  const now = Date.now();
  const total = s.active.endTs - s.active.startTs;
  const remaining = s.active.endTs - now;

  if (remaining <= 0) {
    store.markOverlaid();
    return;
  }
  if (!s.active.nudgeShown && remaining <= total * 0.2) {
    store.nudgeShown();
    return;
  }
  drawRing(now);
  if (s.active && !s.active.overlaid) ticker = requestAnimationFrame(tick);
}

/** Draws the countdown ring and labels for the current time. */
function drawRing(now = Date.now()) {
  const s = store.getState();
  const a = s.active;
  if (!a || a.overlaid) return;
  const total = a.endTs - a.startTs;
  const remaining = Math.max(0, a.endTs - now);
  const fraction = total > 0 ? remaining / total : 0;

  $("app-ring").setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE * (1 - fraction)));
  $("run-time").textContent = formatMs(remaining);
  const consumed = Math.round((1 - fraction) * 100);
  $("run-pct").textContent = consumed + "%";
}

/** Renders the setup/running swap plus the nudge panel state. */
function renderTimer() {
  const s = store.getState();
  const active = s.active;

  $("session-setup").hidden = Boolean(active);
  $("session-running").hidden = !active;
  $("setup-tip").hidden = Boolean(active);

  if (active) {
    $("run-intent").textContent = active.intent || "No intent — just a timer.";
    const app = APPS.find((a) => a.id === active.appId) || APPS[0];
    $("run-app").textContent = active.manual ? "" : app.name;
    $("nudge").hidden = !(active.nudgeShown && !active.answered && !active.overlaid && !active.manual);
    $("btn-one-more").hidden = s.strict;
    if (active.nudgeShown && !active.overlaid) {
      drawRing();
    } else if (active.overlaid) {
      $("app-ring").setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
      $("run-time").textContent = "00:00";
      $("run-pct").textContent = "100%";
    }
  }

  stopTicker();
  if (s.active && !s.active.overlaid) ticker = requestAnimationFrame(tick);
}

/* ============================================================
   Setup inputs (app picker, minute pills, intent)
   ============================================================ */

/** Builds the app picker tiles. */
function renderAppPicker() {
  const wrap = $("app-picker");
  wrap.innerHTML = "";
  APPS.forEach((app) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-tile";
    btn.setAttribute("aria-pressed", String(store.getState().appId === app.id));
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(store.getState().appId === app.id));
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = app.color;
    dot.style.color = app.fg;
    dot.textContent = app.mark;
    const name = document.createElement("span");
    name.textContent = app.name;
    btn.append(dot, name);
    btn.addEventListener("click", () => store.setApp(app.id));
    wrap.appendChild(btn);
  });
}

/** Builds the minute preset pills. */
function renderMinutePills() {
  const wrap = $("minute-pills");
  wrap.innerHTML = "";
  const state = store.getState();
  MINUTE_PRESETS.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "minute-pill" + (state.minutes === m ? " selected" : "");
    btn.setAttribute("aria-pressed", String(state.minutes === m));
    btn.textContent = m + " min";
    btn.addEventListener("click", () => {
      setCustom(false);
      store.setLimit(m);
    });
    wrap.appendChild(btn);
  });
  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "minute-pill" + (!MINUTE_PRESETS.includes(state.minutes) ? " selected" : "");
  custom.setAttribute("aria-pressed", String(!MINUTE_PRESETS.includes(state.minutes)));
  custom.textContent = "Custom";
  custom.addEventListener("click", () => {
    setCustom(true);
    store.setLimit(Number($("custom-min").value) || 7);
  });
  wrap.appendChild(custom);
}

/** Shows or hides the custom-minutes number field. */
function setCustom(show) {
  $("custom-min-wrap").hidden = !show;
  if (show) $("custom-min").focus();
}

/** Wires all timer setup inputs. */
function initTimerInputs() {
  $("intent-input").addEventListener("input", (e) => {
    store.setIntent(e.target.value);
  });
  $("custom-min").addEventListener("input", (e) => {
    const n = Number(e.target.value);
    if (n >= 1) store.setLimit(n);
  });
  $("btn-start").addEventListener("click", () => {
    if ($("custom-min-wrap").hidden) {
      store.startSession();
    } else {
      store.setLimit(Number($("custom-min").value));
      store.startSession();
    }
  });
  $("btn-im-good").addEventListener("click", () => store.goodToGo());
  $("btn-one-more").addEventListener("click", () => store.oneMoreMinute());
  $("btn-end").addEventListener("click", () => store.endSession());
  $("btn-break").addEventListener("click", () => store.takeBreak());
  $("btn-five").addEventListener("click", () => store.snooze());
}

/* ============================================================
   Time's-up overlay (breathing)
   ============================================================ */

let breathTimer = null;

/** Runs the 10-second breathing animation in the overlay. */
function runBreathing() {
  clearTimeout(breathTimer);
  const orb = $("breath");
  orb.textContent = "In";
  orb.classList.remove("in", "out");
  orb.classList.add("in");
  breathTimer = setTimeout(() => {
    orb.textContent = "Out";
    orb.classList.remove("in");
    orb.classList.add("out");
  }, SEC * 5);
}

/** Shows or hides the overlay based on state, and manages snooze count. */
function renderOverlay() {
  const s = store.getState();
  const active = s.active;
  const show = Boolean(active && active.overlaid);
  const overlay = $("overlay");
  if (show) {
    overlay.hidden = false;
    $("btn-five").hidden = s.strict || store.snoozesToday() >= MAX_SNOOZES_PER_DAY || (active && active.snoozed);
    const left = MAX_SNOOZES_PER_DAY - store.snoozesToday();
    $("snooze-count").textContent = left > 0 ? left + " snooze" + (left === 1 ? "" : "s") + " left today" : "No snoozes left today";
    runBreathing();
  } else {
    overlay.hidden = true;
    clearTimeout(breathTimer);
  }
}

/* ============================================================
   Apps view (limits + quiet hours)
   ============================================================ */

/** Renders the per-app daily limit rows. */
function renderLimits() {
  const s = store.getState();
  const wrap = $("limits-list");
  wrap.innerHTML = "";
  APPS.forEach((app) => {
    const row = document.createElement("div");
    row.className = "limit-row";

    const mark = document.createElement("span");
    mark.className = "app-mark";
    mark.style.background = app.color;
    mark.style.color = app.fg;
    mark.textContent = app.mark;

    const grow = document.createElement("div");
    grow.className = "grow";
    const name = document.createElement("p");
    name.className = "name";
    name.textContent = app.name;
    const used = document.createElement("p");
    used.className = "used";
    const todaySessions = s.sessions.filter((rec) => rec.date === todayKey() && rec.appId === app.id);
    used.textContent = todaySessions.length + " session" + (todaySessions.length === 1 ? "" : "s") + " today";

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.value = String(s.limits[app.id]);
    input.setAttribute("aria-label", app.name + " daily limit in minutes");
    input.addEventListener("change", () => {
      store.setAppLimit(app.id, Number(input.value));
    });

    grow.append(name, used);
    row.append(mark, grow, input);
    wrap.appendChild(row);
  });
}

/** Wires the quiet-hours controls. */
function initQuietInputs() {
  $("quiet-toggle").addEventListener("change", (e) => {
    const s = store.getState();
    store.setQuietHours({ enabled: e.target.checked, start: s.quietHours.start, end: s.quietHours.end });
  });
  $("quiet-start").addEventListener("change", (e) => {
    const s = store.getState();
    store.setQuietHours({ enabled: s.quietHours.enabled, start: e.target.value, end: s.quietHours.end });
  });
  $("quiet-end").addEventListener("change", (e) => {
    const s = store.getState();
    store.setQuietHours({ enabled: s.quietHours.enabled, start: s.quietHours.start, end: e.target.value });
  });
}

/* ============================================================
   Stats view
   ============================================================ */

/** Computes today's aggregates from the session history. */
function todayStats() {
  const s = store.getState();
  const today = todayKey();
  const day = s.sessions.filter((rec) => rec.date === today);
  const sessions = day.length;
  const snoozed = day.filter((rec) => rec.snoozed).length;
  const resisted = day.filter((rec) => rec.mode === "limit" && !rec.snoozed).length;
  return { sessions, snoozed, resisted };
}

/** Computes the streak of days where a limit ended deliberately. */
function computeStreak() {
  const s = store.getState();
  const qualifying = new Set(
    s.sessions.filter((rec) => rec.mode === "limit" && !rec.snoozed).map((rec) => rec.date)
  );
  const probe = new Date();
  if (!qualifying.has(todayKey(probe))) probe.setDate(probe.getDate() - 1);
  let streak = 0;
  while (qualifying.has(todayKey(probe))) {
    streak += 1;
    probe.setDate(probe.getDate() - 1);
  }
  return streak;
}

/** Renders the tiles and the 7-day bar chart. */
function renderStats() {
  const s = store.getState();
  const stats = todayStats();
  $("stat-sessions").textContent = String(stats.sessions);
  $("stat-resisted").textContent = String(stats.resisted);
  $("stat-snoozed").textContent = String(stats.snoozed);
  $("stat-streak").textContent = String(computeStreak()) + " day" + (computeStreak() === 1 ? "" : "s");

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = todayKey(d);
    const minutes = s.sessions
      .filter((rec) => rec.date === key)
      .reduce((sum, rec) => sum + rec.minutes, 0);
    days.push({ key, minutes, label: d.toLocaleDateString("en-US", { weekday: "narrow" }) });
  }

  const max = Math.max(1, ...days.map((d) => d.minutes));
  const svg = $("chart");
  const W = 320;
  const H = 140;
  const padBottom = 8;
  const floorY = H - padBottom;
  const topY = 14;
  const barHeight = floorY - topY;
  const barW = 26;
  const slot = (W - 12) / days.length;

  svg.innerHTML = "";
  days.forEach((day, i) => {
    const x = 6 + i * slot + (slot - barW) / 2;
    const h = day.minutes > 0 ? Math.max(6, (day.minutes / max) * barHeight) : 3;
    const y = floorY - h;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("width", String(barW));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "5");
    const isToday = i === days.length - 1;
    rect.setAttribute("fill", isToday ? "var(--accent-strong)" : "var(--track)");
    const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
    t.textContent = day.label + ": " + day.minutes + " min";
    rect.appendChild(t);
    svg.appendChild(rect);

    if (day.minutes > 0) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", String(x + barW / 2));
      label.setAttribute("y", String(y - 4));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "10");
      label.setAttribute("font-family", "inherit");
      label.setAttribute("fill", "var(--muted)");
      label.textContent = String(day.minutes);
      svg.appendChild(label);
    }
  });

  const labelWrap = $("chart-days");
  labelWrap.innerHTML = "";
  days.forEach((day) => {
    const span = document.createElement("span");
    span.textContent = day.label;
    labelWrap.appendChild(span);
  });
}

/* ============================================================
   Settings view
   ============================================================ */

/** Wires the settings switches and data buttons. */
function initSettings() {
  $("strict-toggle").addEventListener("change", (e) => {
    store.setStrict(e.target.checked);
  });

  $("btn-export").addEventListener("click", () => {
    const blob = new Blob([store.exportData()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pausescroll-data.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  $("btn-reset-day").addEventListener("click", () => {
    if (confirm("Reset today's stats? Your history for today will be removed.")) store.resetDay();
  });

  $("btn-reset").addEventListener("click", () => {
    if (confirm("Reset everything? All PauseScroll data on this device will be erased.")) {
      store.resetAll();
      localStorage.removeItem("ps_theme");
      location.reload();
    }
  });
}

/** Reflects settings state back into the controls. */
function renderSettings() {
  const s = store.getState();
  $("strict-toggle").checked = s.strict;
  $("quiet-toggle").checked = s.quietHours.enabled;
  $("quiet-start").value = s.quietHours.start;
  $("quiet-end").value = s.quietHours.end;
  document.querySelectorAll("[data-theme-option]").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.themeOption === document.documentElement.getAttribute("data-theme"));
    btn.setAttribute("aria-pressed", String(btn.dataset.themeOption === document.documentElement.getAttribute("data-theme")));
  });
}

/** Reflects the setup-form current app/minute/intent selection. */
function renderSetupState() {
  const s = store.getState();
  document.querySelectorAll("#app-picker .app-tile").forEach((tile, i) => {
    const selected = APPS[i].id === s.appId;
    tile.setAttribute("aria-pressed", String(selected));
    tile.setAttribute("aria-checked", String(selected));
  });
  document.querySelectorAll("#minute-pills .minute-pill").forEach((btn) => {
    const isCustom = btn.textContent === "Custom";
    const selected = isCustom ? !MINUTE_PRESETS.includes(s.minutes) : s.minutes === Number(btn.textContent.split(" ")[0]);
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", String(selected));
  });
  const customVisible = !MINUTE_PRESETS.includes(s.minutes);
  $("custom-min-wrap").hidden = !customVisible;
  if (customVisible && document.activeElement !== $("custom-min")) {
    $("custom-min").value = String(s.minutes);
  }
  if (document.activeElement !== $("intent-input")) {
    $("intent-input").value = s.intent;
  }
}

/* ============================================================
   Quiet hours
   ============================================================ */

/** Applies (or removes) the dimmed quiet-hours theme. */
function renderQuiet() {
  const s = store.getState();
  const q = s.quietHours;
  const inWindow = q.enabled && inQuietWindow(q.start, q.end);
  $("app-root").classList.toggle("quiet", inWindow);
  $("quiet-banner").hidden = !inWindow;
}

/* ============================================================
   Master render
   ============================================================ */

/** Renders everything from the current store state. */
function render() {
  renderTimer();
  renderOverlay();
  renderStats();
  renderSettings();
  renderQuiet();
  renderSetupState();
}

/* ============================================================
   Service worker + update toast
   ============================================================ */

/** Registers the service worker and shows an update toast when a new one is ready. */
function initSw() {
  if (!("serviceWorker" in navigator)) return;
  const toast = $("update-toast");
  const reloadBtn = $("update-reload");

  const toastShow = () => {
    toast.classList.add("show");
  };
  reloadBtn.addEventListener("click", () => {
    if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "PS_SKIP_WAITING" });
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            toastShow();
          }
        });
      });
    }).catch(() => {});
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "PS_RELOAD") {
      window.location.reload();
    }
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

/* ============================================================
   Boot
   ============================================================ */

initTheme();
initTabs();
initTimerInputs();
initQuietInputs();
initSettings();
initSw();

renderAppPicker();
renderMinutePills();
render();

store.subscribe(render);

/* Quiet-hours re-check every 30 seconds even with no active session. */
setInterval(() => {
  const box = $("quiet-banner");
  if (!box.hidden || !$("app-root").classList.contains("quiet")) renderQuiet();
}, 30 * SEC);