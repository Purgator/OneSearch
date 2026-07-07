"use strict";

// OneSearch background service worker:
// - relays the keyboard command / toolbar click to the content script
// - shows the live match count on the toolbar badge

function toggleInTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "os-toggle" }).catch(() => {
    // Page where content scripts can't run (chrome://, web store, PDF viewer...)
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "toggle-search" && tab && tab.id != null) toggleInTab(tab.id);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) toggleInTab(tab.id);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "os-open-options") {
    chrome.runtime.openOptionsPage();
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
