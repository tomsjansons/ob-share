// ob-share Chrome Extension - Options Page

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";

// DOM elements
const urlInput = document.getElementById("obShareUrl");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");

// Load saved settings
async function loadSettings() {
  const result = await chrome.storage.sync.get(["obShareUrl"]);
  urlInput.value = result.obShareUrl || "";
  urlInput.placeholder = DEFAULT_OB_SHARE_URL;
}

// Save settings
async function saveSettings() {
  const url = urlInput.value.trim();

  // Validate URL if provided
  if (url) {
    try {
      new URL(url);
    } catch {
      showStatus("Please enter a valid URL", "error");
      return;
    }

    // Remove trailing slash
    const cleanUrl = url.replace(/\/+$/, "");
    await chrome.storage.sync.set({ obShareUrl: cleanUrl });
  } else {
    // Clear to use default
    await chrome.storage.sync.remove(["obShareUrl"]);
  }

  showStatus("Settings saved successfully!", "success");
}

// Reset to default
async function resetSettings() {
  await chrome.storage.sync.remove(["obShareUrl"]);
  urlInput.value = "";
  showStatus("Settings reset to default", "success");
}

// Show status message
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;

  // Auto-hide after 3 seconds
  setTimeout(() => {
    statusEl.className = "status";
  }, 3000);
}

// Event listeners
saveBtn.addEventListener("click", saveSettings);
resetBtn.addEventListener("click", resetSettings);

// Save on Enter key
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    saveSettings();
  }
});

// Load settings on page load
loadSettings();
