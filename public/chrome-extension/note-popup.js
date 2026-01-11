// ob-share Chrome Extension - Note Popup

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const pageUrl = params.get("url") || "";
const pageTitle = params.get("title") || pageUrl;
const tabId = parseInt(params.get("tabId") || "0", 10);

// DOM elements
const titleEl = document.getElementById("pageTitle");
const urlEl = document.getElementById("pageUrl");
const noteEl = document.getElementById("note");
const shareBtn = document.getElementById("shareBtn");
const cancelBtn = document.getElementById("cancelBtn");
const modeUrlOnly = document.getElementById("modeUrlOnly");
const modeFullPage = document.getElementById("modeFullPage");

// Current selected mode
let selectedMode = "url_only";

// Display the URL being shared
titleEl.textContent = pageTitle;
urlEl.textContent = pageUrl;

// Get the configured ob-share URL
async function getObShareUrl() {
  const result = await chrome.storage.sync.get(["obShareUrl"]);
  return result.obShareUrl || DEFAULT_OB_SHARE_URL;
}

// Load the default share mode from settings
async function loadDefaultMode() {
  const result = await chrome.storage.sync.get(["defaultShareMode"]);
  const defaultMode = result.defaultShareMode || "url_only";
  selectMode(defaultMode);
}

// Update mode selection UI
function selectMode(mode) {
  selectedMode = mode;
  modeUrlOnly.classList.toggle("selected", mode === "url_only");
  modeFullPage.classList.toggle("selected", mode === "full_page");
}

// Share to ob-share
async function share() {
  const note = noteEl.value.trim();

  // Disable button while sharing
  shareBtn.disabled = true;
  shareBtn.textContent = "Sharing...";

  try {
    // Send message to background script to handle the share
    chrome.runtime.sendMessage(
      {
        action: "shareWithMode",
        mode: selectedMode,
        url: pageUrl,
        title: pageTitle,
        note: note,
        tabId: tabId,
      },
      (response) => {
        if (response?.success) {
          window.close();
        } else {
          console.error("Share failed:", response?.error);
          shareBtn.disabled = false;
          shareBtn.textContent = "Share";
        }
      }
    );
  } catch (error) {
    console.error("Share error:", error);
    shareBtn.disabled = false;
    shareBtn.textContent = "Share";
  }
}

// Cancel and close
function cancel() {
  window.close();
}

// Event listeners
shareBtn.addEventListener("click", share);
cancelBtn.addEventListener("click", cancel);

// Mode selection
modeUrlOnly.addEventListener("click", () => selectMode("url_only"));
modeFullPage.addEventListener("click", () => selectMode("full_page"));

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + Enter to share
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    share();
  }

  // Escape to cancel
  if (e.key === "Escape") {
    cancel();
  }
});

// Focus the textarea
noteEl.focus();

// Load default mode from settings
loadDefaultMode();
