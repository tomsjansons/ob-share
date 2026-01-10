// ob-share Chrome Extension - Note Popup

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";

// Get URL parameters
const params = new URLSearchParams(window.location.search);
const pageUrl = params.get("url") || "";
const pageTitle = params.get("title") || pageUrl;

// DOM elements
const titleEl = document.getElementById("pageTitle");
const urlEl = document.getElementById("pageUrl");
const noteEl = document.getElementById("note");
const shareBtn = document.getElementById("shareBtn");
const cancelBtn = document.getElementById("cancelBtn");

// Display the URL being shared
titleEl.textContent = pageTitle;
urlEl.textContent = pageUrl;

// Get the configured ob-share URL
async function getObShareUrl() {
  const result = await chrome.storage.sync.get(["obShareUrl"]);
  return result.obShareUrl || DEFAULT_OB_SHARE_URL;
}

// Share to ob-share
async function share() {
  const note = noteEl.value.trim();
  const baseUrl = await getObShareUrl();

  const shareParams = new URLSearchParams({
    url: pageUrl,
    title: pageTitle,
  });

  if (note) {
    shareParams.set("text", note);
  }

  const shareUrl = `${baseUrl}/share?${shareParams.toString()}`;

  // Open share page and close popup
  chrome.tabs.create({ url: shareUrl });
  window.close();
}

// Cancel and close
function cancel() {
  window.close();
}

// Event listeners
shareBtn.addEventListener("click", share);
cancelBtn.addEventListener("click", cancel);

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
