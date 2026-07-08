"use strict";

// OneSearch options page — loads settings from chrome.storage.sync,
// saves on every change, live-updates the highlight preview.

const DEFAULTS = {
  colors: ["#ffd54a", "#7ef29a", "#7ecbff", "#ff9df2", "#ffb27e"],
  activeColor: "#ff4d2e",
  rainbow: true,
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  ignoreDiacritics: true,
  highlightAll: true,
  spotlight: true,
  spotlightDuration: 750,
  spotlightRings: 3,
  spotlightThickness: 3,
  spotlightStagger: 90,
  spotlightColor: "",
  minimap: true,
  quickFind: true,
  typeAheadFind: false,
  badge: true,
  smoothScroll: true,
  persistQuery: true,
  maxMatches: 10000
};

const BOOL_KEYS = [
  "rainbow", "matchCase", "wholeWord", "useRegex", "ignoreDiacritics",
  "highlightAll", "spotlight", "minimap", "quickFind", "typeAheadFind",
  "badge", "smoothScroll", "persistQuery"
];

const $ = (id) => document.getElementById(id);

let settings = { ...DEFAULTS };
let saveTimer = 0;

function save() {
  chrome.storage.sync.set(settings, () => {
    const banner = $("saved");
    banner.classList.add("show");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => banner.classList.remove("show"), 1200);
  });
  renderPreview();
}

function renderPalette() {
  const wrap = $("palette");
  wrap.textContent = "";
  settings.colors.forEach((c, i) => {
    const cell = document.createElement("div");
    cell.className = "swatch";
    const input = document.createElement("input");
    input.type = "color";
    input.value = c;
    input.addEventListener("input", () => {
      settings.colors[i] = input.value;
      save();
    });
    const label = document.createElement("div");
    label.textContent = "Color " + (i + 1);
    cell.appendChild(input);
    cell.appendChild(label);
    wrap.appendChild(cell);
  });
}

function contrastText(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 140 ? "#1a1a1a" : "#ffffff";
}

function renderPreview() {
  document.querySelectorAll("#preview mark[data-c]").forEach((mark) => {
    const i = +mark.dataset.c;
    const c = settings.rainbow ? settings.colors[i % settings.colors.length] : settings.colors[0];
    mark.style.background = c;
    mark.style.color = contrastText(c);
  });
  const active = document.querySelector("#preview mark[data-a]");
  active.style.background = settings.activeColor;
  active.style.color = contrastText(settings.activeColor);
  const spotTarget = $("spot-target");
  spotTarget.style.background = settings.activeColor;
  spotTarget.style.color = contrastText(settings.activeColor);
}

// Replays the content-script spotlight animation on the sample match above,
// using the exact same math, so tuning feels truthful.
let previewLayer = null;
let previewAnim = 0;

function playSpotlightPreview() {
  cancelAnimationFrame(previewAnim);
  if (previewLayer) previewLayer.remove();

  const target = $("spot-target");
  const layer = document.createElement("div");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9999;";
  document.body.appendChild(layer);
  previewLayer = layer;

  const D = Math.max(250, settings.spotlightDuration | 0);
  const color = settings.spotlightColor || settings.activeColor;
  const ringCount = Math.min(6, Math.max(1, settings.spotlightRings | 0 || 3));
  const stagger = Math.min(400, Math.max(0, settings.spotlightStagger | 0));
  const thickness = Math.min(10, Math.max(1, settings.spotlightThickness | 0 || 3));
  const travel = Math.max(150, D - stagger * (ringCount - 1));

  const rings = [];
  for (let j = 0; j < ringCount; j++) {
    const r = document.createElement("div");
    r.style.cssText =
      `position:absolute;left:0;top:0;border-radius:50%;border:${thickness}px solid ${color};` +
      `box-shadow:0 0 18px ${color}, inset 0 0 18px ${color};will-change:transform,opacity;opacity:0;`;
    layer.appendChild(r);
    rings.push(r);
  }
  const flash = document.createElement("div");
  flash.style.cssText =
    `position:absolute;left:0;top:0;border-radius:8px;opacity:0;` +
    `box-shadow:0 0 0 4px ${color}, 0 0 30px ${color};will-change:transform,opacity;`;
  layer.appendChild(flash);

  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  const t0 = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const frame = (now) => {
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const base = Math.max(rect.width, rect.height, 30) + 26;
    const startScale = (diag * 1.15) / base;
    const t = now - t0;
    let alive = false;

    rings.forEach((r, j) => {
      const local = (t - j * stagger) / travel;
      if (local < 0) { r.style.opacity = "0"; alive = true; return; }
      if (local >= 1) { r.style.opacity = "0"; return; }
      alive = true;
      const p = easeOut(Math.min(1, local));
      const s = startScale + (1 - startScale) * p;
      r.style.width = base + "px";
      r.style.height = base + "px";
      r.style.opacity = String(0.15 + 0.75 * p);
      r.style.transform = `translate(${cx - base / 2}px, ${cy - base / 2}px) scale(${s})`;
    });

    const fp = (t - (D - 160)) / 320;
    if (fp >= 0 && fp < 1) {
      alive = true;
      flash.style.width = rect.width + 10 + "px";
      flash.style.height = rect.height + 8 + "px";
      flash.style.transform = `translate(${rect.left - 5}px, ${rect.top - 4}px)`;
      flash.style.opacity = String(0.9 * (1 - fp));
    } else if (fp >= 1) {
      flash.style.opacity = "0";
    }

    if (alive || fp < 1) {
      previewAnim = requestAnimationFrame(frame);
    } else {
      layer.remove();
      previewLayer = null;
    }
  };
  previewAnim = requestAnimationFrame(frame);
}

function bind() {
  for (const key of BOOL_KEYS) {
    const el = $(key);
    el.checked = !!settings[key];
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      save();
    });
  }

  $("activeColor").value = settings.activeColor;
  $("activeColor").addEventListener("input", (e) => {
    settings.activeColor = e.target.value;
    save();
  });

  const bindRange = (id, key, unit) => {
    const el = $(id);
    const val = $(id + "Val");
    el.value = settings[key];
    val.textContent = settings[key] + unit;
    el.addEventListener("input", () => {
      settings[key] = +el.value;
      val.textContent = el.value + unit;
      save();
    });
  };
  bindRange("spotlightDuration", "spotlightDuration", " ms");
  bindRange("spotlightRings", "spotlightRings", "");
  bindRange("spotlightThickness", "spotlightThickness", " px");
  bindRange("spotlightStagger", "spotlightStagger", " ms");

  // Custom ring color: empty string in storage means "follow active color".
  const colorOn = $("spotlightColorOn");
  const colorPick = $("spotlightColorPick");
  colorOn.checked = !!settings.spotlightColor;
  colorPick.value = settings.spotlightColor || settings.activeColor;
  colorPick.style.opacity = colorOn.checked ? "1" : "0.35";
  colorOn.addEventListener("change", () => {
    settings.spotlightColor = colorOn.checked ? colorPick.value : "";
    colorPick.style.opacity = colorOn.checked ? "1" : "0.35";
    save();
  });
  colorPick.addEventListener("input", () => {
    if (!colorOn.checked) { colorOn.checked = true; colorPick.style.opacity = "1"; }
    settings.spotlightColor = colorPick.value;
    save();
  });

  $("spot-play").addEventListener("click", playSpotlightPreview);

  const maxM = $("maxMatches");
  maxM.value = settings.maxMatches;
  maxM.addEventListener("change", () => {
    const v = Math.min(100000, Math.max(100, +maxM.value || DEFAULTS.maxMatches));
    settings.maxMatches = v;
    maxM.value = v;
    save();
  });

  $("reset").addEventListener("click", () => {
    settings = structuredClone(DEFAULTS);
    chrome.storage.sync.clear(() => {
      chrome.storage.sync.set(settings, () => location.reload());
    });
  });
}

chrome.storage.sync.get(null, (stored) => {
  settings = { ...DEFAULTS, ...(stored || {}) };
  if (!Array.isArray(settings.colors) || settings.colors.length !== DEFAULTS.colors.length) {
    settings.colors = [...DEFAULTS.colors];
  }
  renderPalette();
  renderPreview();
  bind();
});
