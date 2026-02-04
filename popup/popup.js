/**
 * Advanced Auto Refresher - Popup Script
 * Handles UI interactions and communication with background service worker
 */

// DOM Elements
const elements = {
  // Status
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.querySelector('.status-text'),

  // Timer controls
  intervalInput: document.getElementById('intervalInput'),
  toggleRefresh: document.getElementById('toggleRefresh'),

  // Stochastic
  stochasticMode: document.getElementById('stochasticMode'),
  stochasticOptions: document.getElementById('stochasticOptions'),
  minLimit: document.getElementById('minLimit'),
  distributionRadios: document.querySelectorAll('input[name="distribution"]'),

  // Content watch
  contentWatchEnabled: document.getElementById('contentWatchEnabled'),
  contentWatchOptions: document.getElementById('contentWatchOptions'),
  pickerModeBtn: document.getElementById('pickerModeBtn'),
  advancedModeBtn: document.getElementById('advancedModeBtn'),
  pickerMode: document.getElementById('pickerMode'),
  advancedMode: document.getElementById('advancedMode'),
  startPicker: document.getElementById('startPicker'),
  cssSelector: document.getElementById('cssSelector'),
  testSelector: document.getElementById('testSelector'),
  selectedValue: document.getElementById('selectedValue'),
  currentValue: document.getElementById('currentValue'),
  currentValueDisplay: document.getElementById('currentValueDisplay'),

  // Blacklist/Whitelist
  blacklistToggle: document.getElementById('blacklistToggle'),
  blacklistContent: document.getElementById('blacklistContent'),
  blacklistUrl: document.getElementById('blacklistUrl'),
  whitelistUrl: document.getElementById('whitelistUrl'),
  addBlacklist: document.getElementById('addBlacklist'),
  addWhitelist: document.getElementById('addWhitelist'),
  blacklistList: document.getElementById('blacklistList'),
  whitelistList: document.getElementById('whitelistList'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Alert
  alertOverlay: document.getElementById('alertOverlay'),
  stopAlert: document.getElementById('stopAlert')
};

// State
let currentTabId = null;
let currentTabUrl = null;
let tabSettings = null;

// Initialize popup
async function init() {
  // Initialize internationalization
  await window.i18n.init();
  window.i18n.createLanguageSelector(document.getElementById('languageSelector'));

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  currentTabUrl = tab.url;

  // Load settings for this tab
  await loadTabSettings();

  // Setup event listeners
  setupEventListeners();

  // Load blacklist/whitelist
  await loadUrlLists();

  // Update UI based on settings
  updateUI();
}

// Load settings for current tab
async function loadTabSettings() {
  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_SETTINGS',
    tabId: currentTabId
  });

  tabSettings = response || {
    isActive: false,
    interval: 30,
    stochastic: false,
    minLimit: 5,
    distribution: 'uniform',
    contentWatch: {
      enabled: false,
      selector: '',
      lastValue: null
    }
  };
}

// Update UI based on current settings
function updateUI() {
  // Status indicator
  if (tabSettings.isActive) {
    elements.statusIndicator.classList.add('active');
    elements.statusText.textContent = window.i18n.t('status.active');
    elements.toggleRefresh.classList.add('active');
    elements.toggleRefresh.querySelector('.btn-text').textContent = window.i18n.t('timer.stop');
    elements.toggleRefresh.querySelector('.btn-icon').textContent = '⏹';
  } else {
    elements.statusIndicator.classList.remove('active');
    elements.statusText.textContent = window.i18n.t('status.inactive');
    elements.toggleRefresh.classList.remove('active');
    elements.toggleRefresh.querySelector('.btn-text').textContent = window.i18n.t('timer.start');
    elements.toggleRefresh.querySelector('.btn-icon').textContent = '▶';
  }

  // Timer settings
  elements.intervalInput.value = tabSettings.interval;
  elements.stochasticMode.checked = tabSettings.stochastic;
  elements.minLimit.value = tabSettings.minLimit;

  // Distribution
  elements.distributionRadios.forEach(radio => {
    radio.checked = radio.value === tabSettings.distribution;
  });

  // Stochastic options visibility
  if (tabSettings.stochastic) {
    elements.stochasticOptions.classList.add('visible');
  } else {
    elements.stochasticOptions.classList.remove('visible');
  }

  // Content watch
  elements.contentWatchEnabled.checked = tabSettings.contentWatch?.enabled || false;
  if (tabSettings.contentWatch?.enabled) {
    elements.contentWatchOptions.classList.add('visible');
  } else {
    elements.contentWatchOptions.classList.remove('visible');
  }

  // CSS Selector
  if (tabSettings.contentWatch?.selector) {
    elements.cssSelector.value = tabSettings.contentWatch.selector;
    elements.selectedValue.textContent = tabSettings.contentWatch.selector;
    if (tabSettings.contentWatch.lastValue !== null) {
      elements.currentValue.textContent = tabSettings.contentWatch.lastValue;
    }
  }
}

// Setup event listeners
function setupEventListeners() {
  // Toggle refresh
  elements.toggleRefresh.addEventListener('click', toggleRefresh);

  // Interval change
  elements.intervalInput.addEventListener('change', saveSettings);

  // Stochastic mode toggle
  elements.stochasticMode.addEventListener('change', () => {
    if (elements.stochasticMode.checked) {
      elements.stochasticOptions.classList.add('visible');
    } else {
      elements.stochasticOptions.classList.remove('visible');
    }
    saveSettings();
  });

  // Min limit change
  elements.minLimit.addEventListener('change', saveSettings);

  // Distribution change
  elements.distributionRadios.forEach(radio => {
    radio.addEventListener('change', saveSettings);
  });

  // Content watch toggle
  elements.contentWatchEnabled.addEventListener('change', () => {
    if (elements.contentWatchEnabled.checked) {
      elements.contentWatchOptions.classList.add('visible');
    } else {
      elements.contentWatchOptions.classList.remove('visible');
    }
    saveSettings();
  });

  // Picker/Advanced mode switch
  elements.pickerModeBtn.addEventListener('click', () => {
    elements.pickerModeBtn.classList.add('active');
    elements.advancedModeBtn.classList.remove('active');
    elements.pickerMode.classList.remove('hidden');
    elements.advancedMode.classList.add('hidden');
  });

  elements.advancedModeBtn.addEventListener('click', () => {
    elements.advancedModeBtn.classList.add('active');
    elements.pickerModeBtn.classList.remove('active');
    elements.advancedMode.classList.remove('hidden');
    elements.pickerMode.classList.add('hidden');
  });

  // Start picker
  elements.startPicker.addEventListener('click', startElementPicker);

  // Test selector
  elements.testSelector.addEventListener('click', testCssSelector);

  // CSS Selector change
  elements.cssSelector.addEventListener('change', saveSettings);

  // Blacklist toggle
  elements.blacklistToggle.addEventListener('click', () => {
    const section = elements.blacklistToggle.closest('.collapsible');
    section.classList.toggle('collapsed');
  });

  // Tabs
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      elements.tabs.forEach(t => t.classList.remove('active'));
      elements.tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tabName}Tab`).classList.add('active');
    });
  });

  // Add blacklist/whitelist
  elements.addBlacklist.addEventListener('click', () => addUrl('blacklist'));
  elements.addWhitelist.addEventListener('click', () => addUrl('whitelist'));

  // Enter key for URL inputs
  elements.blacklistUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUrl('blacklist');
  });
  elements.whitelistUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addUrl('whitelist');
  });

  // Stop alert
  elements.stopAlert.addEventListener('click', stopAlert);

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ALERT_TRIGGERED') {
      showAlertOverlay();
    }
    if (message.type === 'VALUE_UPDATED') {
      elements.currentValue.textContent = message.value;
    }
  });
}

// Toggle refresh on/off
async function toggleRefresh() {
  tabSettings.isActive = !tabSettings.isActive;

  await chrome.runtime.sendMessage({
    type: 'TOGGLE_REFRESH',
    tabId: currentTabId,
    tabUrl: currentTabUrl,
    settings: getSettingsFromUI()
  });

  updateUI();
}

// Get current settings from UI
function getSettingsFromUI() {
  const distribution = Array.from(elements.distributionRadios).find(r => r.checked)?.value || 'uniform';

  return {
    isActive: tabSettings.isActive,
    interval: parseInt(elements.intervalInput.value) || 30,
    stochastic: elements.stochasticMode.checked,
    minLimit: parseInt(elements.minLimit.value) || 5,
    distribution: distribution,
    contentWatch: {
      enabled: elements.contentWatchEnabled.checked,
      selector: elements.cssSelector.value,
      lastValue: tabSettings.contentWatch?.lastValue || null
    }
  };
}

// Save settings
async function saveSettings() {
  const settings = getSettingsFromUI();
  tabSettings = { ...tabSettings, ...settings };

  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    tabId: currentTabId,
    tabUrl: currentTabUrl,
    settings: settings
  });
}

// Start element picker
async function startElementPicker() {
  // Close popup and activate picker in content script
  await chrome.tabs.sendMessage(currentTabId, { type: 'START_PICKER' });
  window.close();
}

// Test CSS selector
async function testCssSelector() {
  const selector = elements.cssSelector.value;
  if (!selector) return;

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'TEST_SELECTOR',
      selector: selector
    });

    if (response.success) {
      elements.currentValue.textContent = response.value;
      tabSettings.contentWatch.lastValue = response.numericValue;
      saveSettings();
    } else {
      elements.currentValue.textContent = window.i18n.t('contentWatch.error');
    }
  } catch (error) {
    elements.currentValue.textContent = window.i18n.t('contentWatch.error');
  }
}

// Load URL lists
async function loadUrlLists() {
  const result = await chrome.storage.sync.get(['urlBlacklist', 'urlWhitelist']);
  const blacklist = result.urlBlacklist || [];
  const whitelist = result.urlWhitelist || [];

  renderUrlList(elements.blacklistList, blacklist, 'blacklist');
  renderUrlList(elements.whitelistList, whitelist, 'whitelist');
}

// Render URL list
function renderUrlList(container, urls, type) {
  container.innerHTML = '';
  urls.forEach(url => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${url}</span>
      <button data-url="${url}" data-type="${type}">×</button>
    `;
    li.querySelector('button').addEventListener('click', (e) => {
      removeUrl(e.target.dataset.type, e.target.dataset.url);
    });
    container.appendChild(li);
  });
}

// Add URL to list
async function addUrl(type) {
  const input = type === 'blacklist' ? elements.blacklistUrl : elements.whitelistUrl;
  const url = input.value.trim();
  if (!url) return;

  const key = type === 'blacklist' ? 'urlBlacklist' : 'urlWhitelist';
  const result = await chrome.storage.sync.get([key]);
  const urls = result[key] || [];

  if (!urls.includes(url)) {
    urls.push(url);
    await chrome.storage.sync.set({ [key]: urls });
    loadUrlLists();
  }

  input.value = '';
}

// Remove URL from list
async function removeUrl(type, url) {
  const key = type === 'blacklist' ? 'urlBlacklist' : 'urlWhitelist';
  const result = await chrome.storage.sync.get([key]);
  let urls = result[key] || [];

  urls = urls.filter(u => u !== url);
  await chrome.storage.sync.set({ [key]: urls });
  loadUrlLists();
}

// Show alert overlay
function showAlertOverlay() {
  elements.alertOverlay.classList.remove('hidden');
}

// Stop alert
async function stopAlert() {
  elements.alertOverlay.classList.add('hidden');
  await chrome.runtime.sendMessage({ type: 'STOP_ALERT' });
}

// Initialize
init();
