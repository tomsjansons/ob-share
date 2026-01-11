// ob-share Chrome Extension - Background Service Worker
// Version 1.1.0 - Added full page capture support

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";

// Share modes
const SHARE_MODE = {
  URL_ONLY: "url_only",           // Just share the URL (default, fast)
  FULL_PAGE: "full_page",         // Capture full HTML + text + metadata
};

// Get the configured ob-share URL
async function getObShareUrl() {
  const result = await chrome.storage.sync.get(["obShareUrl"]);
  return result.obShareUrl || DEFAULT_OB_SHARE_URL;
}

// Get the configured default share mode
async function getDefaultShareMode() {
  const result = await chrome.storage.sync.get(["defaultShareMode"]);
  return result.defaultShareMode || SHARE_MODE.URL_ONLY;
}

// Share a URL to ob-share (URL-only mode)
async function shareUrlToObShare(url, title, note = "") {
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

// Capture full page content from a tab
async function capturePageContent(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Extract main article content using common selectors
        function extractArticle() {
          const selectors = [
            "article",
            '[role="main"]',
            ".post-content",
            ".article-content",
            ".entry-content",
            ".content-body",
            ".post-body",
            "main",
            "#content",
            ".content",
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.length > 200) {
              return {
                html: el.innerHTML,
                text: el.innerText,
              };
            }
          }
          return null;
        }

        // Extract metadata from the page
        function extractMetadata() {
          const getMeta = (name) => {
            const el = document.querySelector(
              `meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`
            );
            return el?.content || null;
          };

          return {
            description: getMeta("description") || getMeta("og:description"),
            author: getMeta("author") || getMeta("article:author"),
            publishedTime: getMeta("article:published_time") || getMeta("datePublished"),
            siteName: getMeta("og:site_name"),
            ogImage: getMeta("og:image"),
            keywords: getMeta("keywords"),
          };
        }

        // Get selected text if any
        const selection = window.getSelection()?.toString() || "";

        // Extract article content
        const article = extractArticle();

        return {
          url: window.location.href,
          title: document.title,

          // Full page content
          html: document.documentElement.outerHTML,
          bodyText: document.body.innerText,

          // Extracted article (if found)
          articleHtml: article?.html || null,
          articleText: article?.text || null,

          // Current selection
          selection: selection,

          // Metadata
          meta: extractMetadata(),

          // Capture timestamp
          capturedAt: new Date().toISOString(),
        };
      },
    });

    return results[0]?.result || null;
  } catch (error) {
    console.error("Failed to capture page content:", error);
    return null;
  }
}

// Share full page content via POST to ob-share
async function shareFullPageToObShare(tab, note = "") {
  const baseUrl = await getObShareUrl();

  // Show capturing indicator
  try {
    await chrome.action.setBadgeText({ text: "...", tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: "#7c3aed", tabId: tab.id });
  } catch (e) {
    // Badge may fail on some pages, ignore
  }

  try {
    // Capture the page content
    const captured = await capturePageContent(tab.id);

    if (!captured) {
      // Fall back to URL-only mode
      console.warn("Could not capture page, falling back to URL mode");
      await shareUrlToObShare(tab.url, tab.title, note);
      return;
    }

    // Add user note if provided
    if (note) {
      captured.userNote = note;
    }

    // POST the captured content to ob-share
    const response = await fetch(`${baseUrl}/api/share/captured`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(captured),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();

    // Redirect to share page with the content ID
    if (result.id) {
      chrome.tabs.create({ url: `${baseUrl}/share?id=${result.id}` });
    } else {
      // Fallback: server returned share URL directly
      chrome.tabs.create({ url: result.shareUrl || `${baseUrl}/share` });
    }
  } catch (error) {
    console.error("Failed to share full page:", error);
    // Fall back to URL-only mode on error
    await shareUrlToObShare(tab.url, tab.title, note);
  } finally {
    // Clear badge
    try {
      await chrome.action.setBadgeText({ text: "", tabId: tab.id });
    } catch (e) {
      // Ignore
    }
  }
}

// Smart share - uses configured default mode
async function smartShare(tab, note = "") {
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return;
  }

  const mode = await getDefaultShareMode();

  if (mode === SHARE_MODE.FULL_PAGE) {
    await shareFullPageToObShare(tab, note);
  } else {
    await shareUrlToObShare(tab.url, tab.title, note);
  }
}

// Handle extension icon click - uses default share mode
chrome.action.onClicked.addListener(async (tab) => {
  await smartShare(tab);
});

// Create context menus on install
chrome.runtime.onInstalled.addListener(() => {
  // Clear existing menus first
  chrome.contextMenus.removeAll(() => {
    // Main share option (uses default mode)
    chrome.contextMenus.create({
      id: "share-page",
      title: "Share this page to ob-share",
      contexts: ["page", "frame"],
    });

    // Share with note option (uses default mode)
    chrome.contextMenus.create({
      id: "share-with-note",
      title: "Share with note...",
      contexts: ["page", "frame"],
    });

    // Separator before explicit mode options
    chrome.contextMenus.create({
      id: "separator-1",
      type: "separator",
      contexts: ["page", "frame"],
    });

    // Explicit URL-only share
    chrome.contextMenus.create({
      id: "share-url-only",
      title: "Share URL only",
      contexts: ["page", "frame"],
    });

    // Explicit full page capture
    chrome.contextMenus.create({
      id: "share-full-page",
      title: "Capture full page content",
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

    // Separator before settings
    chrome.contextMenus.create({
      id: "separator-3",
      type: "separator",
      contexts: ["page", "frame", "link", "selection"],
    });

    // Settings option
    chrome.contextMenus.create({
      id: "settings",
      title: "Settings",
      contexts: ["page", "frame"],
    });
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case "share-page":
      // Uses default share mode
      await smartShare(tab);
      break;

    case "share-with-note":
      if (tab.url && !tab.url.startsWith("chrome://")) {
        // Open popup window for note input
        chrome.windows.create({
          url: `note-popup.html?url=${encodeURIComponent(tab.url)}&title=${encodeURIComponent(tab.title || "")}&tabId=${tab.id}`,
          type: "popup",
          width: 450,
          height: 400,
          focused: true,
        });
      }
      break;

    case "share-url-only":
      // Explicit URL-only mode
      if (tab.url && !tab.url.startsWith("chrome://")) {
        await shareUrlToObShare(tab.url, tab.title);
      }
      break;

    case "share-full-page":
      // Explicit full page capture
      if (tab.url && !tab.url.startsWith("chrome://")) {
        await shareFullPageToObShare(tab);
      }
      break;

    case "share-link":
      if (info.linkUrl) {
        await shareUrlToObShare(info.linkUrl, info.linkUrl);
      }
      break;

    case "share-selection":
      if (info.selectionText && tab.url) {
        // Share the page URL with the selected text as a note
        await shareUrlToObShare(tab.url, tab.title, info.selectionText);
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
    // Legacy URL-only share
    shareUrlToObShare(message.url, message.title, message.note).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === "shareWithMode") {
    // Share with specified mode
    const doShare = async () => {
      try {
        if (message.mode === SHARE_MODE.FULL_PAGE && message.tabId) {
          // Get the tab to capture
          const tab = await chrome.tabs.get(message.tabId);
          await shareFullPageToObShare(tab, message.note);
        } else {
          await shareUrlToObShare(message.url, message.title, message.note);
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error("Share failed:", error);
        sendResponse({ success: false, error: error.message });
      }
    };
    doShare();
    return true;
  }

  if (message.action === "getDefaultShareMode") {
    getDefaultShareMode().then((mode) => {
      sendResponse({ mode });
    });
    return true;
  }
});
