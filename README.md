# OneSearch — Advanced Find in Page

A Chrome extension that replaces the default **Ctrl+F** with the find bar you always wanted — the soul of classic Firefox search, with modern superpowers layered on top.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![No page mutation](https://img.shields.io/badge/DOM-untouched-green)

## Why

Chrome's find bar hasn't changed in 15 years. Firefox in the good old days had *Highlight All*, type-ahead find with `/`, links-only quick find with `'`, the pink "phrase not found" flash, and F3 find-again. OneSearch brings all of that back — and goes further.

## Features

### Search engine
- **Search as you type** — instant, debounced, zero flicker
- **Match case**, **whole words**, **regular expressions** — toggle from the bar (`Alt+C/W/R`)
- **Diacritics-insensitive** — `resume` finds `résumé`, `uber` finds `über` (`Alt+D`)
- **Highlight All** — the legendary Firefox toggle (`Alt+A`)
- Built on the **CSS Custom Highlight API**: the page's DOM is never modified, so nothing ever breaks — no mangled React apps, no broken listeners
- Live re-search when the page mutates (SPAs, infinite scroll)
- Match cap for gigantic pages (configurable)

### Finding your way
- **Rainbow highlights** — matches cycle through 5 configurable colors so adjacent results never blur together
- **Spotlight rings** 🎯 — when you jump to a result, concentric rings sweep in from the edges of the screen and converge on the match. You physically cannot lose it. Fully tunable: speed, ring count, thickness, launch stagger, custom color — with a live preview in the options page.
- **Scrollbar minimap** — colored ticks along the right edge show where every match lives in the document; click a tick to jump straight there
- **`3 / 127` live counter** + match count on the toolbar badge
- "Reached end — wrapped to top ↺" notice, like the old days
- Pink not-found input, amber invalid-regex input

### Old-school quick find
- Press **`/`** anywhere → quick find (auto-dismisses after 5 s of inactivity, Firefox-2004 style)
- Press **`'`** → quick find **links only**; **Enter follows the link**
- **Search when you start typing** (off by default) — the classic Firefox accessibility option: any printable key outside a form field starts a quick find instantly
- **F3 / Shift+F3 / Ctrl+G** — find again, even with the bar closed

### Ergonomics
- Opens with **Ctrl+F** (overrides the native bar) or **Ctrl+Shift+F** or the toolbar icon
- Draggable, glassmorphic bar that stays out of your way
- Remembers your last search, pre-selected on reopen
- Everything configurable in a polished options page; settings sync across your Chrome profiles

## Install (unpacked)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Hit **Ctrl+F** on any page

> Requires Chrome 105+ (CSS Custom Highlight API).

## Keyboard reference

| Keys | Action |
|---|---|
| `Ctrl+F` | Open OneSearch (replaces native find) |
| `Enter` / `Shift+Enter` | Next / previous match |
| `F3` / `Shift+F3` / `Ctrl+G` | Find again (works with bar closed) |
| `/` | Quick find (auto-dismiss) |
| `'` | Quick find in links only — `Enter` opens the link |
| `Alt+C` `Alt+W` `Alt+R` `Alt+D` `Alt+A` | Case / Word / Regex / Diacritics / Highlight-all |
| `Esc` | Close |

## Project layout

```
manifest.json        MV3 manifest
src/content.js       Find bar UI, search engine, highlights, spotlight, minimap
src/background.js    Command relay + toolbar badge
src/options.html/js  Options page
icons/               Generated icons
tools/make-icons.ps1 Icon generator (PowerShell / System.Drawing)
```

## Notes

- Content scripts can't run on `chrome://` pages, the Web Store, or the built-in PDF viewer — the native find bar still works there.
- Highlights are pure paint (Custom Highlight API): copy/paste, selection and page scripts are completely unaffected.
