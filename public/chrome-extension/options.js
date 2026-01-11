// ob-share Chrome Extension - Options Page

const DEFAULT_OB_SHARE_URL = "https://ob-share.up.railway.app";
const DEFAULT_SHARE_MODE = "url_only";

// DOM elements
const urlInput = document.getElementById("obShareUrl");
const saveBtn = document.getElementById("saveBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const shareModeGroup = document.getElementById("shareModeGroup");
const radioOptions = document.querySelectorAll(".radio-option");

// Load saved settings
async function loadSettings() {
  const result = await chrome.storage.sync.get(["obShareUrl", "defaultShareMode"]);
  urlInput.value = result.obShareUrl || "";
  urlInput.placeholder = DEFAULT_OB_SHARE_URL;

  // Set share mode radio
  const mode = result.defaultShareMode || DEFAULT_SHARE_MODE;
  const radio = document.querySelector(`input[name="shareMode"][value="${mode}"]`);
  if (radio) {
    radio.checked = true;
    updateRadioSelection(mode);
  }
}

// Update visual selection state for radio options
function updateRadioSelection(selectedMode) {
  radioOptions.forEach((option) => {
    const isSelected = option.dataset.mode === selectedMode;
    option.classList.toggle("selected", isSelected);
  });
}

// Get selected share mode
function getSelectedShareMode() {
  const checked = document.querySelector('input[name="shareMode"]:checked');
  return checked?.value || DEFAULT_SHARE_MODE;
}

// Save settings
async function saveSettings() {
  const url = urlInput.value.trim();
  const shareMode = getSelectedShareMode();

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
    await chrome.storage.sync.set({
      obShareUrl: cleanUrl,
      defaultShareMode: shareMode,
    });
  } else {
    // Clear URL to use default, but save share mode
    await chrome.storage.sync.remove(["obShareUrl"]);
    await chrome.storage.sync.set({ defaultShareMode: shareMode });
  }

  showStatus("Settings saved successfully!", "success");
}

// Reset to default
async function resetSettings() {
  await chrome.storage.sync.remove(["obShareUrl", "defaultShareMode"]);
  urlInput.value = "";

  // Reset radio to default
  const defaultRadio = document.querySelector('input[name="shareMode"][value="url_only"]');
  if (defaultRadio) {
    defaultRadio.checked = true;
    updateRadioSelection("url_only");
  }

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

// Save on Enter key in URL input
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    saveSettings();
  }
});

// Handle radio option clicks
radioOptions.forEach((option) => {
  option.addEventListener("click", () => {
    const radio = option.querySelector('input[type="radio"]');
    if (radio) {
      radio.checked = true;
      updateRadioSelection(option.dataset.mode);
    }
  });
});

// Handle radio change events
shareModeGroup.addEventListener("change", (e) => {
  if (e.target.type === "radio") {
    updateRadioSelection(e.target.value);
  }
});

// Load settings on page load
loadSettings();
