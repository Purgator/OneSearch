"use strict";

// OneSearch toolbar popup: quick actions + the Firefox host-permission
// banner. Firefox MV3 treats all host permissions as optional, so content
// scripts don't inject until the user grants site access — without this
// banner the extension would look silently broken there. Chrome grants
// <all_urls> at install, so the banner never shows.
//
// Callback style throughout: Firefox's chrome.* namespace does not return
// promises the way Chrome's does.

const ALL_URLS = { origins: ["<all_urls>"] };
const $ = (id) => document.getElementById(id);

chrome.permissions.contains(ALL_URLS, (has) => {
  $("banner").hidden = !!has;
});

$("grant").addEventListener("click", () => {
  chrome.permissions.request(ALL_URLS, (granted) => {
    if (chrome.runtime.lastError || !granted) return; // user declined; banner stays
    $("banner").hidden = true;
    $("granted").hidden = false;
  });
});

$("search").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || tab.id == null) return;
    chrome.tabs.sendMessage(tab.id, { type: "os-toggle" }, () => {
      if (chrome.runtime.lastError) {
        // No content script here: restricted page, or (Firefox) permission
        // granted after this tab loaded and it wasn't reloaded yet.
        $("err").hidden = false;
        return;
      }
      window.close();
    });
  });
});

$("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$("version").textContent = "v" + chrome.runtime.getManifest().version;

// Show the user's actual "open bar" binding on the button.
chrome.storage.sync.get("keymap", (stored) => {
  const binding = stored && stored.keymap && Array.isArray(stored.keymap.openBar)
    ? stored.keymap.openBar[0]
    : null;
  if (binding) $("openKey").textContent = binding;
});
