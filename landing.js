/* ============================================================
   PauseScroll — landing.js
   Theme toggle, install prompt, APK fallback, count-up stats,
   4-stage live demo, and service worker registration.
   ============================================================ */

/** Reads a persisted theme or falls back to the OS preference. */
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

/* ------------------- Theme toggle ------------------- */

/** Wires the theme toggle button. */
function initTheme() {
  const saved = localStorage.getItem("ps_theme");
  if (saved !== "dark" && saved !== "light") {
    document.documentElement.setAttribute("data-theme", currentTheme());
  } else {
    document.documentElement.setAttribute("data-theme", saved);
  }
  const toggle = document.getElementById("theme-toggle");
  toggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

/* ------------------- Install prompt ------------------- */

let deferredPrompt = null;

/** Returns true when the app already runs as an installed PWA. */
function isInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    navigator.standalone === true
  );
}

/** Wires beforeinstallprompt, install buttons, and the installed state. */
function initInstall() {
  const buttons = [
    document.getElementById("install-btn-header"),
    document.getElementById("install-btn-hero"),
    document.getElementById("install-btn-getapp"),
  ];

  const hideButtons = () => {
    for (const b of buttons) b.hidden = true;
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    for (const b of buttons) b.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideButtons();
    const note = document.getElementById("installed-note");
    if (note) note.hidden = false;
  });

  if (isInstalled()) {
    hideButtons();
    const note = document.getElementById("installed-note");
    if (note) note.hidden = false;
  }

  for (const b of buttons) {
    b.addEventListener("click", async () => {
      if (!deferredPrompt) {
        document.getElementById("get-app").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        return;
      }
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        deferredPrompt = null;
        hideButtons();
      } else {
        deferredPrompt = null;
      }
    });
  }
}

/* ------------------- APK graceful fallback ------------------- */

/** Checks whether the APK exists; when missing, swaps the button for a friendly note. */
async function initApkButton() {
  const button = document.getElementById("apk-btn");
  const note = document.getElementById("apk-note");
  try {
    const res = await fetch("downloads/pausescroll.apk", { method: "HEAD" });
    if (res.ok) {
      button.addEventListener("click", () => {
        window.location.href = "downloads/pausescroll.apk";
      });
      return;
    }
  } catch {
    /* offline or blocked — fall through to the friendly note */
  }
  button.hidden = true;
  note.hidden = false;
}

/* ------------------- Count-up stats ------------------- */

/**
 * Animates a number from 0 to its target once it scrolls into view.
 * Respects prefers-reduced-motion by setting the value immediately.
 */
function initCountUp() {
  const els = document.querySelectorAll("[data-count]");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => {
      el.textContent = Number(el.dataset.count).toLocaleString("en-US");
    });
    return;
  }
  const animate = (el, target) => {
    if (reducedMotion) {
      el.textContent = target.toLocaleString("en-US");
      return;
    }
    const start = performance.now();
    const duration = 1300;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(eased * target);
      el.textContent = value.toLocaleString("en-US");
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target, Number(entry.target.dataset.count));
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.6 }
  );
  els.forEach((el) => io.observe(el));
}

/* ------------------- Live demo ------------------- */

const RING_CIRCUMFERENCE = 552.92;

/** Formats seconds as m:ss. */
function formatSeconds(total) {
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return m + ":" + String(s).padStart(2, "0");
}

/** A tiny state machine driving the demo phone mockup. */
const demo = {
  state: "setup",
  running: false,
  duration: 600,
  elapsed: 0,
  raf: null,
  lastTs: 0,

  setRing(remainingFraction) {
    /* remainingFraction goes 1 → 0; the ring drains as time is consumed. */
    const offset = RING_CIRCUMFERENCE * (1 - remainingFraction);
    document.getElementById("demo-ring").setAttribute("stroke-dashoffset", String(offset));
  },

  render() {
    const time = document.getElementById("demo-time");
    const hint = document.getElementById("demo-hint");
    const label = document.getElementById("demo-label");
    const status = document.getElementById("demo-status");
    const nudge = document.getElementById("demo-nudge");
    const toggle = document.getElementById("demo-toggle");
    const stepBtn = document.getElementById("demo-step");
    const steps = {
      set: document.getElementById("demo-step-set"),
      run: document.getElementById("demo-step-run"),
      nudge: document.getElementById("demo-step-nudge"),
      end: document.getElementById("demo-step-end"),
    };
    Object.values(steps).forEach((li) => li.classList.remove("active"));

    if (this.state === "setup") {
      time.textContent = "10:00";
      hint.textContent = "set";
      label.textContent = "Session";
      status.textContent = "Ready when you are. Pick an app and a budget.";
      nudge.hidden = true;
      this.setRing(1);
      toggle.hidden = false;
      toggle.disabled = false;
      toggle.textContent = "Play";
      stepBtn.textContent = "Play";
      steps.set.classList.add("active");
    } else if (this.state === "running") {
      const remaining = Math.max(0, this.duration - this.elapsed);
      time.textContent = formatSeconds(remaining);
      hint.textContent = "stay with it";
      label.textContent = "Quick scroll";
      status.textContent = "Running. Stay with the moment, not the feed.";
      nudge.hidden = true;
      this.setRing(remaining / this.duration);
      toggle.hidden = false;
      toggle.disabled = false;
      toggle.textContent = this.running ? "Pause" : "Resume";
      stepBtn.textContent = "Skip to nudge";
      steps.run.classList.add("active");
    } else if (this.state === "nudge") {
      time.textContent = "02:00";
      hint.textContent = "20% left";
      label.textContent = "Still valuable?";
      status.textContent = "80% spent — a gentle question.";
      nudge.hidden = false;
      this.setRing(0.2);
      toggle.hidden = true;
      stepBtn.textContent = "Finish the session";
      steps.nudge.classList.add("active");
    } else {
      time.textContent = "00:00";
      hint.textContent = "paused";
      label.textContent = "Wind down";
      status.textContent = "Paused. Breathe in for four, out for six.";
      nudge.hidden = true;
      this.setRing(0);
      toggle.hidden = true;
      stepBtn.textContent = "Restart demo";
      steps.end.classList.add("active");
    }
  },

  tick(now) {
    if (!this.running) return;
    const delta = (now - this.lastTs) / 1000;
    this.lastTs = now;
    /* Compress a 10-minute session into ~5 wall-clock seconds. */
    this.elapsed += delta * (this.duration / 5);
    if (this.elapsed >= this.duration * 0.8) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.elapsed = this.duration * 0.8;
      this.state = "nudge";
      this.render();
      return;
    }
    this.render();
    this.raf = requestAnimationFrame(this.tick.bind(this));
  },

  play() {
    this.running = true;
    if (this.state === "setup") {
      this.state = "running";
      this.elapsed = 0;
    }
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.tick.bind(this));
  },
};

/** Wires the demo play/pause, step, and reset controls. */
function initDemo() {
  const toggle = document.getElementById("demo-toggle");
  const stepBtn = document.getElementById("demo-step");
  const resetBtn = document.getElementById("demo-reset");

  const stop = () => {
    demo.running = false;
    if (demo.raf) cancelAnimationFrame(demo.raf);
  };

  toggle.addEventListener("click", () => {
    if (demo.running) {
      stop();
      demo.render();
    } else {
      demo.play();
      demo.render();
    }
  });

  stepBtn.addEventListener("click", () => {
    stop();
    if (demo.state === "setup") demo.state = "running";
    else if (demo.state === "running") demo.state = "nudge";
    else if (demo.state === "nudge") demo.state = "end";
    else demo.state = "setup";
    if (demo.state === "running") demo.play();
    demo.render();
  });

  resetBtn.addEventListener("click", () => {
    stop();
    demo.state = "setup";
    demo.elapsed = 0;
    demo.render();
  });

  demo.render();
}

/* ------------------- Service worker ------------------- */

/** Registers the service worker (safe to call from both pages). */
function initSw() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* Registration can fail on some private modes — the page still works. */
    });
  });
}

/* ------------------- Boot ------------------- */

initTheme();
initInstall();
initApkButton();
initCountUp();
initDemo();
initSw();