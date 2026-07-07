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
  minimap: true,
  quickFind: true,
  badge: true,
  smoothScroll: true,
  persistQuery: true,
  maxMatches: 10000
};

const BOOL_KEYS = [
  "rainbow", "matchCase", "wholeWord", "useRegex", "ignoreDiacritics",
  "highlightAll", "spotlight", "minimap", "quickFind", "badge",
  "smoothScroll", "persistQuery"
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

  const dur = $("spotlightDuration");
  const durVal = $("spotlightDurationVal");
  dur.value = settings.spotlightDuration;
  durVal.textContent = settings.spotlightDuration + " ms";
  dur.addEventListener("input", () => {
    settings.spotlightDuration = +dur.value;
    durVal.textContent = dur.value + " ms";
    save();
  });

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
