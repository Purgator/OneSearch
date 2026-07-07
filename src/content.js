"use strict";

// ============================================================================
// OneSearch — advanced find-in-page, inspired by classic Firefox:
//   - search-as-you-type with "Highlight All"
//   - / opens quick-find, ' opens links-only quick-find (auto-dismiss)
//   - pink "phrase not found" input, "wrapped to top" notice
//   - F3 / Shift+F3 / Ctrl+G find-again, Enter opens the active link in
//     links-only mode
// ...plus modern extras: rainbow highlights (CSS Custom Highlight API, zero
// DOM mutation), a converging spotlight ring that pinpoints the active match,
// and a scrollbar minimap of every result.
// ============================================================================

(() => {
  if (window.__ONESEARCH_ACTIVE__) return;
  window.__ONESEARCH_ACTIVE__ = true;

  const HAS_HIGHLIGHT_API = typeof CSS !== "undefined" && "highlights" in CSS;
  if (!HAS_HIGHLIGHT_API) {
    console.warn("[OneSearch] CSS Custom Highlight API not available; OneSearch is disabled on this page.");
    return;
  }

  // --------------------------------------------------------------------------
  // Settings
  // --------------------------------------------------------------------------

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

  let settings = { ...DEFAULTS };

  function applyStoredSettings(stored) {
    settings = { ...DEFAULTS, ...(stored || {}) };
    if (!Array.isArray(settings.colors) || settings.colors.length === 0) {
      settings.colors = [...DEFAULTS.colors];
    }
  }

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const state = {
    open: false,
    quick: false,        // quick-find mode (auto-dismisses like old Firefox)
    linksOnly: false,    // ' quick-find: only match text inside links
    query: "",
    matches: [],         // [{ range, node, start, end }]
    active: -1,
    capped: false,
    invalidRegex: false,
    quickTimer: 0,
    searchTimer: 0,
    mutateTimer: 0
  };

  // --------------------------------------------------------------------------
  // Highlight registry + page-level styles (adopted stylesheet: CSP-proof)
  // --------------------------------------------------------------------------

  const HL_BUCKETS = 5;
  const buckets = [];
  for (let i = 0; i < HL_BUCKETS; i++) {
    const h = new Highlight();
    h.priority = 1;
    buckets.push(h);
    CSS.highlights.set("onesearch-h" + i, h);
  }
  const activeHl = new Highlight();
  activeHl.priority = 100;
  CSS.highlights.set("onesearch-active", activeHl);

  const pageSheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];

  function contrastText(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#000";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 140 ? "#1a1a1a" : "#ffffff";
  }

  function refreshHighlightStyles() {
    const rules = [];
    for (let i = 0; i < HL_BUCKETS; i++) {
      const c = settings.colors[i % settings.colors.length];
      rules.push(`::highlight(onesearch-h${i}){background-color:${c};color:${contrastText(c)};}`);
    }
    rules.push(
      `::highlight(onesearch-active){background-color:${settings.activeColor};` +
      `color:${contrastText(settings.activeColor)};text-decoration:underline 2px;}`
    );
    pageSheet.replaceSync(rules.join("\n"));
  }

  // --------------------------------------------------------------------------
  // Text folding (case + diacritics insensitive matching with offset mapping)
  // --------------------------------------------------------------------------

  const COMBINING = /[̀-ͯ]/g;

  function foldString(text) {
    let out = "";
    for (const ch of text) {
      let f = ch;
      if (settings.ignoreDiacritics) {
        f = ch.normalize("NFD").replace(COMBINING, "");
        if (f === "") continue; // standalone combining mark
      }
      if (!state.matchCase) f = f.toLowerCase();
      out += f;
    }
    return out;
  }

  // Returns { folded, map } where map[i] = UTF-16 offset in `text` of the
  // original character that produced folded char i.
  function foldWithMap(text) {
    let folded = "";
    const map = [];
    let idx = 0;
    for (const ch of text) {
      let f = ch;
      if (settings.ignoreDiacritics) {
        f = ch.normalize("NFD").replace(COMBINING, "");
      }
      if (!state.matchCase) f = f.toLowerCase();
      for (let k = 0; k < f.length; k++) map.push(idx);
      folded += f;
      idx += ch.length;
    }
    return { folded, map };
  }

  function charLenAt(text, i) {
    const cp = text.codePointAt(i);
    return cp > 0xffff ? 2 : 1;
  }

  // Extend an end offset over trailing combining marks so NFD-form accents
  // (e.g. "e" + U+0301) stay inside the highlighted range.
  function absorbCombining(text, end) {
    while (end < text.length) {
      const cp = text.codePointAt(end);
      if (cp >= 0x0300 && cp <= 0x036f) end++;
      else break;
    }
    return end;
  }

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // --------------------------------------------------------------------------
  // Matcher
  // --------------------------------------------------------------------------

  function buildMatcher() {
    state.invalidRegex = false;
    const q = state.query;
    if (!q) return null;

    if (state.useRegex) {
      try {
        return { re: new RegExp(q, state.matchCase ? "g" : "gi"), raw: true };
      } catch {
        state.invalidRegex = true;
        return null;
      }
    }

    const foldedQ = foldString(q);
    if (!foldedQ) return null;
    let src = escapeRegExp(foldedQ);
    let flags = "g";
    if (state.wholeWord) {
      src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
      flags += "u";
    }
    return { re: new RegExp(src, flags), raw: false };
  }

  // --------------------------------------------------------------------------
  // DOM text collection
  // --------------------------------------------------------------------------

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE", "TEXTAREA", "IFRAME", "OBJECT"]);

  function collectMatches() {
    const matcher = buildMatcher();
    const matches = [];
    state.capped = false;
    if (!matcher) return matches;

    const visCache = new Map();
    const isVisible = (el) => {
      let v = visCache.get(el);
      if (v === undefined) {
        v = typeof el.checkVisibility === "function"
          ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
          : true;
        visCache.set(el, v);
      }
      return v;
    };

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p === hostEl || hostEl.contains(p)) return NodeFilter.FILTER_REJECT;
        if (!node.data || !node.data.trim()) return NodeFilter.FILTER_SKIP;
        if (state.linksOnly && !p.closest("a[href]")) return NodeFilter.FILTER_SKIP;
        if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const max = Math.max(1, settings.maxMatches | 0);
    let node;
    outer: while ((node = walker.nextNode())) {
      const text = node.data;
      let haystack, map = null;
      if (matcher.raw) {
        haystack = text;
      } else {
        const fm = foldWithMap(text);
        haystack = fm.folded;
        map = fm.map;
      }

      matcher.re.lastIndex = 0;
      let m;
      while ((m = matcher.re.exec(haystack)) !== null) {
        if (m[0].length === 0) { matcher.re.lastIndex++; continue; }
        let start, end;
        if (map) {
          start = map[m.index];
          const lastFolded = m.index + m[0].length - 1;
          const lastOrig = map[lastFolded];
          end = absorbCombining(text, lastOrig + charLenAt(text, lastOrig));
        } else {
          start = m.index;
          end = m.index + m[0].length;
        }
        try {
          const range = new Range();
          range.setStart(node, start);
          range.setEnd(node, end);
          matches.push({ range, node, start, end });
        } catch { /* offsets raced a DOM mutation; skip */ }
        if (matches.length >= max) { state.capped = true; break outer; }
      }
    }
    return matches;
  }

  // --------------------------------------------------------------------------
  // Shadow-DOM UI
  // --------------------------------------------------------------------------

  const hostEl = document.createElement("div");
  hostEl.id = "onesearch-host";
  hostEl.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;";
  const root = hostEl.attachShadow({ mode: "closed" });

  const uiSheet = new CSSStyleSheet();
  uiSheet.replaceSync(`
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", system-ui, Roboto, sans-serif; }

    .bar {
      position: fixed; top: 14px; right: 14px;
      display: none; align-items: center; gap: 6px;
      padding: 8px 10px;
      background: rgba(24, 26, 34, 0.92);
      backdrop-filter: blur(14px) saturate(1.3);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3);
      color: #e8eaf2;
      user-select: none;
      animation: os-drop 160ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
    .bar.open { display: flex; }
    @keyframes os-drop { from { opacity: 0; transform: translateY(-10px) scale(0.97); } }

    .grip {
      cursor: grab; padding: 2px 3px; color: rgba(255,255,255,0.35);
      font-size: 11px; letter-spacing: 1px; line-height: 1;
    }
    .grip:active { cursor: grabbing; }

    .logo { width: 16px; height: 16px; flex: none; opacity: 0.9; }

    input.q {
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 9px;
      color: #f2f4fb;
      font-size: 13.5px;
      padding: 6px 10px;
      width: 230px;
      outline: none;
      transition: background 120ms, border-color 120ms, box-shadow 120ms;
    }
    input.q:focus { border-color: #8b7bf7; box-shadow: 0 0 0 3px rgba(139, 123, 247, 0.25); }
    input.q::placeholder { color: rgba(232, 234, 242, 0.4); }
    .bar.notfound input.q { background: rgba(255, 60, 70, 0.22); border-color: rgba(255, 90, 100, 0.65); }
    .bar.badre   input.q { background: rgba(255, 170, 40, 0.16); border-color: rgba(255, 180, 60, 0.6); }

    .count {
      min-width: 62px; text-align: center;
      font-size: 12px; font-variant-numeric: tabular-nums;
      color: rgba(232, 234, 242, 0.75);
      padding: 0 2px; white-space: nowrap;
    }
    .count b { color: #fff; font-weight: 600; }

    .sep { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.12); }

    button.tgl, button.nav, button.icon {
      appearance: none; border: none; cursor: pointer;
      background: transparent; color: rgba(232, 234, 242, 0.75);
      border-radius: 8px; height: 27px; min-width: 27px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; padding: 0 6px;
      transition: background 100ms, color 100ms, transform 80ms;
    }
    button.tgl:hover, button.nav:hover, button.icon:hover { background: rgba(255, 255, 255, 0.10); color: #fff; }
    button.nav:active, button.tgl:active { transform: scale(0.92); }
    button.tgl.on {
      background: linear-gradient(135deg, #6366f1, #a855f7);
      color: #fff;
      box-shadow: 0 2px 8px rgba(130, 90, 240, 0.5);
    }
    button svg { width: 14px; height: 14px; }

    .chip {
      display: none; font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px;
      padding: 3px 7px; border-radius: 20px;
      background: rgba(99, 102, 241, 0.25); color: #b9b3ff;
      border: 1px solid rgba(139, 123, 247, 0.4);
      white-space: nowrap;
    }
    .bar.quick .chip.quick { display: inline-block; }
    .bar.links .chip.links { display: inline-block; }

    .toast {
      position: absolute; top: calc(100% + 8px); right: 8px;
      background: rgba(24, 26, 34, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #ffd54a; font-size: 12px;
      padding: 6px 12px; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      opacity: 0; transform: translateY(-4px);
      transition: opacity 150ms, transform 150ms;
      pointer-events: none; white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    .minimap {
      position: fixed; top: 0; right: 0; bottom: 0; width: 14px;
      display: none; pointer-events: none;
    }
    .minimap.show { display: block; }
    .minimap .track {
      position: absolute; inset: 0;
      background: linear-gradient(to left, rgba(20, 20, 28, 0.28), transparent);
    }
    .tick {
      position: absolute; right: 2px; width: 9px; height: 3px;
      border-radius: 2px; pointer-events: auto; cursor: pointer;
      box-shadow: 0 0 3px rgba(0, 0, 0, 0.45);
      transition: width 80ms;
    }
    .tick:hover { width: 13px; }
    .tick.active {
      width: 14px; height: 5px; right: 0;
      outline: 1.5px solid #fff;
      box-shadow: 0 0 8px currentColor;
    }

    .spotlayer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
    .ring {
      position: absolute; border-radius: 50%;
      border: 3px solid; left: 0; top: 0;
      will-change: transform, opacity;
      box-shadow: 0 0 18px currentColor, inset 0 0 18px currentColor;
    }
    .flash {
      position: absolute; border-radius: 8px; left: 0; top: 0;
      will-change: transform, opacity;
      box-shadow: 0 0 0 4px currentColor, 0 0 30px currentColor;
    }

    .kbd-hint {
      display: none; font-size: 10.5px; color: rgba(232, 234, 242, 0.45);
      white-space: nowrap; padding-left: 2px;
    }
    .bar.links .kbd-hint { display: inline; }
  `);
  root.adoptedStyleSheets = [uiSheet];

  const SVG_SEARCH = `<svg class="logo" viewBox="0 0 24 24" fill="none" stroke="url(#osg)" stroke-width="2.4" stroke-linecap="round"><defs><linearGradient id="osg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#e879f9"/></linearGradient></defs><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>`;
  const SVG_UP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 14.5 12 7.5 19 14.5"/></svg>`;
  const SVG_DOWN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9.5 12 16.5 19 9.5"/></svg>`;
  const SVG_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.29 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.27.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>`;
  const SVG_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.innerHTML = `
    <span class="grip" title="Drag to move">⣿</span>
    ${SVG_SEARCH}
    <input class="q" type="text" placeholder="Find in page…" spellcheck="false" autocomplete="off">
    <span class="chip quick">QUICK</span>
    <span class="chip links">LINKS</span>
    <span class="kbd-hint">Enter ↵ opens link</span>
    <span class="count">—</span>
    <span class="sep"></span>
    <button class="tgl t-case" title="Match case (Alt+C)">Aa</button>
    <button class="tgl t-word" title="Whole words (Alt+W)">［ab］</button>
    <button class="tgl t-regex" title="Regular expression (Alt+R)">.*</button>
    <button class="tgl t-dia" title="Ignore accents / diacritics (Alt+D)">â≈a</button>
    <button class="tgl t-hla" title="Highlight all (Alt+A) — the classic">✺</button>
    <span class="sep"></span>
    <button class="nav b-prev" title="Previous (Shift+Enter / Shift+F3)">${SVG_UP}</button>
    <button class="nav b-next" title="Next (Enter / F3)">${SVG_DOWN}</button>
    <button class="icon b-opts" title="OneSearch options">${SVG_GEAR}</button>
    <button class="icon b-close" title="Close (Esc)">${SVG_X}</button>
    <span class="toast"></span>
  `;
  root.appendChild(bar);

  const minimap = document.createElement("div");
  minimap.className = "minimap";
  minimap.innerHTML = `<div class="track"></div>`;
  root.appendChild(minimap);

  const spotlayer = document.createElement("div");
  spotlayer.className = "spotlayer";
  root.appendChild(spotlayer);

  const $ = (sel) => bar.querySelector(sel);
  const inputEl = $(".q");
  const countEl = $(".count");
  const toastEl = $(".toast");
  const toggles = {
    matchCase: $(".t-case"),
    wholeWord: $(".t-word"),
    useRegex: $(".t-regex"),
    ignoreDiacritics: $(".t-dia"),
    highlightAll: $(".t-hla")
  };

  function mountHost() {
    if (!hostEl.isConnected && document.body) document.body.appendChild(hostEl);
  }

  // Session toggles start from stored defaults (updated on load below).
  state.matchCase = DEFAULTS.matchCase;
  state.wholeWord = DEFAULTS.wholeWord;
  state.useRegex = DEFAULTS.useRegex;
  state.highlightAllOn = DEFAULTS.highlightAll;

  function syncToggleUI() {
    toggles.matchCase.classList.toggle("on", state.matchCase);
    toggles.wholeWord.classList.toggle("on", state.wholeWord);
    toggles.useRegex.classList.toggle("on", state.useRegex);
    toggles.ignoreDiacritics.classList.toggle("on", settings.ignoreDiacritics);
    toggles.highlightAll.classList.toggle("on", state.highlightAllOn);
  }

  // --------------------------------------------------------------------------
  // Search orchestration
  // --------------------------------------------------------------------------

  function clearHighlights() {
    for (const b of buckets) b.clear();
    activeHl.clear();
  }

  function runSearch({ keepActive = false } = {}) {
    const prev = keepActive && state.active >= 0 ? state.matches[state.active] : null;

    state.matches = collectMatches();
    clearHighlights();

    if (state.highlightAllOn) {
      state.matches.forEach((m, i) => {
        buckets[settings.rainbow ? i % HL_BUCKETS : 0].add(m.range);
      });
    }

    let nextActive = -1;
    if (state.matches.length > 0) {
      if (prev) {
        nextActive = state.matches.findIndex(
          (m) => m.node === prev.node && m.start === prev.start
        );
      }
      if (nextActive < 0) nextActive = firstIndexInView();
    }
    setActive(nextActive, { scroll: !prev });
    renderMinimap();
    updateBarState();
  }

  function scheduleSearch() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => runSearch(), 110);
  }

  function firstIndexInView() {
    const limit = Math.min(state.matches.length, 5000);
    for (let i = 0; i < limit; i++) {
      const r = state.matches[i].range.getBoundingClientRect();
      if (r.bottom >= 0 && r.top < window.innerHeight) return i;
    }
    for (let i = 0; i < limit; i++) {
      const r = state.matches[i].range.getBoundingClientRect();
      if (r.top >= 0) return i;
    }
    return 0;
  }

  function setActive(index, { scroll = true } = {}) {
    activeHl.clear();
    state.active = index;
    if (index < 0 || index >= state.matches.length) {
      updateCount();
      updateBadge();
      return;
    }
    const m = state.matches[index];
    activeHl.add(m.range);
    if (scroll) scrollToMatch(m);
    updateCount();
    updateBadge();
    updateMinimapActive();
  }

  function move(dir) {
    const n = state.matches.length;
    if (n === 0) return;
    let i = state.active + dir;
    let wrapped = false;
    if (i >= n) { i = 0; wrapped = true; }
    if (i < 0) { i = n - 1; wrapped = true; }
    setActive(i);
    if (wrapped) {
      toast(dir > 0 ? "↺ Reached end — wrapped to top" : "↻ Reached top — wrapped to bottom");
    }
    bumpQuickTimer();
  }

  function scrollToMatch(m) {
    const el = m.node.parentElement;
    if (el) {
      el.scrollIntoView({
        behavior: settings.smoothScroll ? "smooth" : "auto",
        block: "center",
        inline: "nearest"
      });
    }
    spotlight(m.range);
  }

  function updateCount() {
    const n = state.matches.length;
    if (!state.query) {
      countEl.innerHTML = "—";
    } else if (n === 0) {
      countEl.innerHTML = state.invalidRegex ? "bad&nbsp;re" : "0&nbsp;/&nbsp;0";
    } else {
      const cap = state.capped ? "+" : "";
      countEl.innerHTML = `<b>${state.active + 1}</b>&nbsp;/&nbsp;${n}${cap}`;
    }
  }

  function updateBarState() {
    bar.classList.toggle("notfound", !!state.query && !state.invalidRegex && state.matches.length === 0);
    bar.classList.toggle("badre", state.invalidRegex);
    updateCount();
  }

  function updateBadge() {
    if (!settings.badge) return;
    try {
      chrome.runtime.sendMessage({ type: "os-badge", count: state.open ? state.matches.length : 0 });
    } catch { /* extension context invalidated (update/reload) */ }
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  // --------------------------------------------------------------------------
  // Spotlight — concentric rings converge from the whole viewport onto the
  // active match, so the eye can't miss it.
  // --------------------------------------------------------------------------

  let spotAnim = 0;

  function spotlight(range) {
    if (!settings.spotlight) return;
    cancelAnimationFrame(spotAnim);
    spotlayer.textContent = "";

    const D = Math.max(250, settings.spotlightDuration | 0);
    const color = settings.activeColor;
    const rings = [];
    for (let j = 0; j < 3; j++) {
      const r = document.createElement("div");
      r.className = "ring";
      r.style.color = color;
      r.style.borderColor = color;
      spotlayer.appendChild(r);
      rings.push(r);
    }
    const flash = document.createElement("div");
    flash.className = "flash";
    flash.style.color = color;
    flash.style.opacity = "0";
    spotlayer.appendChild(flash);

    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    const t0 = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const frame = (now) => {
      const rect = range.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const base = Math.max(rect.width, rect.height, 30) + 26;
      const startScale = (diag * 1.15) / base;
      const t = now - t0;
      let alive = false;

      rings.forEach((r, j) => {
        const local = (t - j * 90) / (D - 90 * 2);
        if (local < 0) { r.style.opacity = "0"; alive = true; return; }
        if (local >= 1) { r.style.opacity = "0"; return; }
        alive = true;
        const p = easeOut(Math.min(1, local));
        const s = startScale + (1 - startScale) * p;
        r.style.width = base + "px";
        r.style.height = base + "px";
        r.style.opacity = String(0.15 + 0.75 * p);
        r.style.transform =
          `translate(${cx - base / 2}px, ${cy - base / 2}px) scale(${s})`;
      });

      // Final flash hugging the match itself.
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
        spotAnim = requestAnimationFrame(frame);
      } else {
        spotlayer.textContent = "";
      }
    };
    spotAnim = requestAnimationFrame(frame);
  }

  // --------------------------------------------------------------------------
  // Minimap — every match as a colored tick along the right edge
  // --------------------------------------------------------------------------

  const MAX_TICKS = 500;
  let tickIndexMap = [];

  function renderMinimap() {
    const old = minimap.querySelectorAll(".tick");
    old.forEach((t) => t.remove());
    tickIndexMap = [];

    const n = state.matches.length;
    const show = settings.minimap && state.open && n > 0;
    minimap.classList.toggle("show", show);
    if (!show) return;

    const docH = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      1
    );
    const stride = Math.max(1, Math.ceil(n / MAX_TICKS));
    const frag = document.createDocumentFragment();

    for (let i = 0; i < n; i += stride) {
      const m = state.matches[i];
      const rect = m.range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const y = ((rect.top + window.scrollY) / docH) * 100;
      const tick = document.createElement("div");
      tick.className = "tick";
      const c = settings.rainbow
        ? settings.colors[i % HL_BUCKETS % settings.colors.length]
        : settings.colors[0];
      tick.style.background = c;
      tick.style.color = c;
      tick.style.top = `calc(${Math.min(99.5, y)}% - 1px)`;
      tick.dataset.i = String(i);
      tick.title = `Match ${i + 1} of ${n}`;
      tick.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setActive(i);
        bumpQuickTimer();
      });
      frag.appendChild(tick);
      tickIndexMap.push(i);
    }
    minimap.appendChild(frag);
    updateMinimapActive();
  }

  function updateMinimapActive() {
    if (!settings.minimap) return;
    minimap.querySelectorAll(".tick.active").forEach((t) => t.classList.remove("active"));
    if (state.active < 0) return;
    // Nearest rendered tick at or below the active index.
    let best = null;
    for (const t of minimap.querySelectorAll(".tick")) {
      const i = +t.dataset.i;
      if (i <= state.active && (best === null || i > +best.dataset.i)) best = t;
    }
    if (best) best.classList.add("active");
  }

  // --------------------------------------------------------------------------
  // Open / close
  // --------------------------------------------------------------------------

  function openBar({ quick = false, linksOnly = false, seed = "" } = {}) {
    mountHost();
    state.open = true;
    state.quick = quick;
    state.linksOnly = linksOnly;
    bar.classList.add("open");
    bar.classList.toggle("quick", quick);
    bar.classList.toggle("links", linksOnly);
    syncToggleUI();

    if (seed) {
      inputEl.value = seed;
      state.query = seed;
    } else if (settings.persistQuery && inputEl.value) {
      state.query = inputEl.value;
    }
    inputEl.focus();
    inputEl.select();
    if (state.query) runSearch();
    else updateBarState();
    startObserver();
    bumpQuickTimer();
  }

  function closeBar() {
    state.open = false;
    state.quick = false;
    state.linksOnly = false;
    bar.classList.remove("open", "quick", "links", "notfound", "badre");
    clearHighlights();
    state.matches = [];
    state.active = -1;
    minimap.classList.remove("show");
    spotlayer.textContent = "";
    cancelAnimationFrame(spotAnim);
    stopObserver();
    clearTimeout(state.quickTimer);
    if (!settings.persistQuery) { inputEl.value = ""; state.query = ""; }
    updateBadge();
  }

  function toggleBar() {
    if (state.open) closeBar();
    else openBar();
  }

  // Quick-find auto-dismiss, like Firefox's type-ahead find of old.
  function bumpQuickTimer() {
    clearTimeout(state.quickTimer);
    if (state.quick && state.open) {
      state.quickTimer = setTimeout(() => {
        if (state.quick) closeBar();
      }, 5000);
    }
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  inputEl.addEventListener("input", () => {
    state.query = inputEl.value;
    scheduleSearch();
    bumpQuickTimer();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.linksOnly && state.active >= 0 && !e.shiftKey) {
        // Classic ' quick-find: Enter follows the focused link.
        const m = state.matches[state.active];
        const a = m.node.parentElement && m.node.parentElement.closest("a[href]");
        if (a) { closeBar(); a.click(); return; }
      }
      move(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeBar();
    } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const k = e.key.toLowerCase();
      const map = { c: "matchCase", w: "wholeWord", r: "useRegex", a: "highlightAll", d: "diacritics" };
      if (map[k]) {
        e.preventDefault();
        toggleOption(map[k]);
      }
    }
    bumpQuickTimer();
  });

  function toggleOption(name) {
    if (name === "matchCase") state.matchCase = !state.matchCase;
    else if (name === "wholeWord") state.wholeWord = !state.wholeWord;
    else if (name === "useRegex") state.useRegex = !state.useRegex;
    else if (name === "highlightAll") state.highlightAllOn = !state.highlightAllOn;
    else if (name === "diacritics") settings.ignoreDiacritics = !settings.ignoreDiacritics;
    syncToggleUI();
    runSearch({ keepActive: true });
    inputEl.focus();
  }

  toggles.matchCase.addEventListener("click", () => toggleOption("matchCase"));
  toggles.wholeWord.addEventListener("click", () => toggleOption("wholeWord"));
  toggles.useRegex.addEventListener("click", () => toggleOption("useRegex"));
  toggles.ignoreDiacritics.addEventListener("click", () => toggleOption("diacritics"));
  toggles.highlightAll.addEventListener("click", () => toggleOption("highlightAll"));

  $(".b-next").addEventListener("click", () => { move(1); inputEl.focus(); });
  $(".b-prev").addEventListener("click", () => { move(-1); inputEl.focus(); });
  $(".b-close").addEventListener("click", closeBar);
  $(".b-opts").addEventListener("click", () => {
    try { chrome.runtime.sendMessage({ type: "os-open-options" }); } catch { }
  });

  // Drag to move the bar.
  (() => {
    const grip = $(".grip");
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      grip.setPointerCapture(e.pointerId);
      const r = bar.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    grip.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const x = Math.min(Math.max(4, ox + e.clientX - sx), window.innerWidth - bar.offsetWidth - 4);
      const y = Math.min(Math.max(4, oy + e.clientY - sy), window.innerHeight - bar.offsetHeight - 4);
      bar.style.left = x + "px";
      bar.style.top = y + "px";
      bar.style.right = "auto";
    });
    grip.addEventListener("pointerup", () => { dragging = false; });
  })();

  // Global keyboard interception (capture phase → beats the page and Chrome).
  function isEditable(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  window.addEventListener("keydown", (e) => {
    const target = e.composedPath ? e.composedPath()[0] : e.target;
    const inOurUI = target === inputEl || bar.contains(target);

    // Ctrl/Cmd+F → replace the native find bar.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      openBar();
      return;
    }

    // F3 / Ctrl+G — find again (classic).
    if (e.key === "F3" || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "g")) {
      if (state.query || inputEl.value) {
        e.preventDefault();
        e.stopPropagation();
        if (!state.open) openBar();
        move(e.shiftKey ? -1 : 1);
      }
      return;
    }

    if (state.open && e.key === "Escape" && !inOurUI) {
      e.preventDefault();
      closeBar();
      return;
    }

    // Firefox type-ahead: / for quick find, ' for links-only quick find.
    if (
      settings.quickFind && !state.open &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      (e.key === "/" || e.key === "'") &&
      !isEditable(target)
    ) {
      e.preventDefault();
      e.stopPropagation();
      inputEl.value = "";
      state.query = "";
      openBar({ quick: true, linksOnly: e.key === "'" });
    }
  }, true);

  // --------------------------------------------------------------------------
  // Keep results fresh when the page mutates
  // --------------------------------------------------------------------------

  const observer = new MutationObserver((muts) => {
    if (!state.open || !state.query) return;
    let relevant = false;
    for (const m of muts) {
      if (m.target === hostEl || hostEl.contains(m.target)) continue;
      relevant = true;
      break;
    }
    if (!relevant) return;
    clearTimeout(state.mutateTimer);
    state.mutateTimer = setTimeout(() => runSearch({ keepActive: true }), 350);
  });

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
  function stopObserver() {
    observer.disconnect();
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (!state.open) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderMinimap, 250);
  });

  // --------------------------------------------------------------------------
  // Messages + settings wiring
  // --------------------------------------------------------------------------

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "os-toggle") toggleBar();
    });

    chrome.storage.sync.get(null, (stored) => {
      applyStoredSettings(stored);
      state.matchCase = settings.matchCase;
      state.wholeWord = settings.wholeWord;
      state.useRegex = settings.useRegex;
      state.highlightAllOn = settings.highlightAll;
      refreshHighlightStyles();
      syncToggleUI();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const merged = { ...settings };
      for (const [k, v] of Object.entries(changes)) merged[k] = v.newValue;
      applyStoredSettings(merged);
      refreshHighlightStyles();
      syncToggleUI();
      if (state.open && state.query) runSearch({ keepActive: true });
    });
  } catch {
    refreshHighlightStyles();
  }

  refreshHighlightStyles();
})();
