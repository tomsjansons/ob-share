// ob-share Chrome Extension - Background Service Worker

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";

// Get the configured ob-share URL
async function getObShareUrl() {
  const result = await chrome.storage.sync.get(["obShareUrl"]);
  return result.obShareUrl || DEFAULT_OB_SHARE_URL;
}

// Share a URL to ob-share
async function shareToObShare(url, title, note = "") {
  const baseUrl = await getObShareUrl();
  const params = new URLSearchParams({
    url: url,
    title: title || "",
  });
  if (note) {
    params.set("text", note);
  }
  const shareUrl = `${baseUrl}/share?${params.toString()}`;
  chrome.tabs.create({ url: shareUrl });
}

// Handle extension icon click - direct share without popup
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && !tab.url.startsWith("chrome://")) {
    await shareToObShare(tab.url, tab.title);
  }
});

// Create context menus on install
chrome.runtime.onInstalled.addListener(() => {
  // Main share option
  chrome.contextMenus.create({
    id: "share-page",
    title: "Share this page to ob-share",
    contexts: ["page", "frame"],
  });

  // Share with note option
  chrome.contextMenus.create({
    id: "share-with-note",
    title: "Share with note...",
    contexts: ["page", "frame"],
  });

  // Share link option (for right-clicking on links)
  chrome.contextMenus.create({
    id: "share-link",
    title: "Share this link to ob-share",
    contexts: ["link"],
  });

  // Share selected text as note
  chrome.contextMenus.create({
    id: "share-selection",
    title: "Share selection to ob-share",
    contexts: ["selection"],
  });

  // Separator
  chrome.contextMenus.create({
    id: "separator",
    type: "separator",
    contexts: ["page", "frame"],
  });

  // Settings option
  chrome.contextMenus.create({
    id: "settings",
    title: "Settings",
    contexts: ["page", "frame"],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case "share-page":
      if (tab.url && !tab.url.startsWith("chrome://")) {
        await shareToObShare(tab.url, tab.title);
      }
      break;

    case "share-with-note":
      if (tab.url && !tab.url.startsWith("chrome://")) {
        // Open popup window for note input
        const baseUrl = await getObShareUrl();
        chrome.windows.create({
          url: `note-popup.html?url=${encodeURIComponent(tab.url)}&title=${encodeURIComponent(tab.title || "")}`,
          type: "popup",
          width: 450,
          height: 350,
          focused: true,
        });
      }
      break;

    case "share-link":
      if (info.linkUrl) {
        await shareToObShare(info.linkUrl, info.linkUrl);
      }
      break;

    case "share-selection":
      if (info.selectionText && tab.url) {
        // Share the page URL with the selected text as a note
        await shareToObShare(tab.url, tab.title, info.selectionText);
      }
      break;

    case "settings":
      chrome.runtime.openOptionsPage();
      break;
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "share") {
    shareToObShare(message.url, message.title, message.note).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  }
});
