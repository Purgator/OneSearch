"use strict";

// OneSearch background (Chrome: service worker, Firefox: event page):
// - relays the keyboard command to the content script
// - shows the live match count on the toolbar badge
// Toolbar clicks open the popup (src/popup.html), not action.onClicked.

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-search" || !tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "os-toggle" }, () => {
    // Swallow "no receiver" on pages where content scripts can't run
    // (browser pages, extension stores, PDF viewer...).
    void chrome.runtime.lastError;
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "os-open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Ctrl+Enter on a link match: open like a real Ctrl+click — right next to
  // the current tab, with opener wired up so closing it returns you here.
  if (msg.type === "os-open-tab" && sender.tab && typeof msg.url === "string" &&
      /^https?:/i.test(msg.url)) {
    chrome.tabs.create({
      url: msg.url,
      active: !!msg.active,
      index: sender.tab.index + 1,
      openerTabId: sender.tab.id
    });
    return;
  }

  if (msg.type === "os-badge" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    const count = msg.count | 0;
    const text = count > 0 ? (count > 999 ? "999+" : String(count)) : "";
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#6d28d9" });
    chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" });
  }
});
