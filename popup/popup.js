/**
 * Auto Refresh & Page Monitor with Telegram Alerts - Popup Script
 * Handles UI interactions and communication with background service worker.
 */

const elements = {
  statusIndicator: document.getElementById('statusIndicator'),
  statusText: document.querySelector('.status-text'),
  intervalInput: document.getElementById('intervalInput'),
  toggleRefresh: document.getElementById('toggleRefresh'),
  stochasticMode: document.getElementById('stochasticMode'),
  stochasticOptions: document.getElementById('stochasticOptions'),
  minLimit: document.getElementById('minLimit'),
  distributionRadios: document.querySelectorAll('input[name="distribution"]'),

  alertRoutingMode: document.getElementById('alertRoutingMode'),
  sharedAlertSettings: document.getElementById('sharedAlertSettings'),
  sharedAlertSound: document.getElementById('sharedAlertSound'),
  sharedAlertVolume: document.getElementById('sharedAlertVolume'),
  sharedAlertVolumeValue: document.getElementById('sharedAlertVolumeValue'),
  previewSharedSound: document.getElementById('previewSharedSound'),

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
  alertMode: document.getElementById('alertMode'),
  thresholdValue: document.getElementById('thresholdValue'),
  thresholdGroup: document.getElementById('thresholdGroup'),
  numericAlertSettings: document.getElementById('numericAlertSettings'),
  numericAlertSound: document.getElementById('numericAlertSound'),
  numericAlertVolume: document.getElementById('numericAlertVolume'),
  numericAlertVolumeValue: document.getElementById('numericAlertVolumeValue'),
  previewNumericSound: document.getElementById('previewNumericSound'),

  textWatchEnabled: document.getElementById('textWatchEnabled'),
  textWatchOptions: document.getElementById('textWatchOptions'),
  textSourceMode: document.getElementById('textSourceMode'),
  textSelectorControls: document.getElementById('textSelectorControls'),
  textPickerModeBtn: document.getElementById('textPickerModeBtn'),
  textAdvancedModeBtn: document.getElementById('textAdvancedModeBtn'),
  textPickerMode: document.getElementById('textPickerMode'),
  textAdvancedMode: document.getElementById('textAdvancedMode'),
  textStartPicker: document.getElementById('textStartPicker'),
  textCssSelector: document.getElementById('textCssSelector'),
  textTestSelector: document.getElementById('textTestSelector'),
  textSelectedValue: document.getElementById('textSelectedValue'),
  textCurrentPreview: document.getElementById('textCurrentPreview'),
  textAlertMode: document.getElementById('textAlertMode'),
  textKeywordList: document.getElementById('textKeywordList'),
  textDebugEnabled: document.getElementById('textDebugEnabled'),
  textAlertSettings: document.getElementById('textAlertSettings'),
  textAlertSound: document.getElementById('textAlertSound'),
  textAlertVolume: document.getElementById('textAlertVolume'),
  textAlertVolumeValue: document.getElementById('textAlertVolumeValue'),
  previewTextSound: document.getElementById('previewTextSound'),

  stopOnClick: document.getElementById('stopOnClick'),

  blacklistToggle: document.getElementById('blacklistToggle'),
  blacklistUrl: document.getElementById('blacklistUrl'),
  whitelistUrl: document.getElementById('whitelistUrl'),
  addBlacklist: document.getElementById('addBlacklist'),
  addWhitelist: document.getElementById('addWhitelist'),
  blacklistList: document.getElementById('blacklistList'),
  whitelistList: document.getElementById('whitelistList'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  telegramEnabled: document.getElementById('telegramEnabled'),
  telegramOptions: document.getElementById('telegramOptions'),
  telegramBotToken: document.getElementById('telegramBotToken'),
  telegramChatId: document.getElementById('telegramChatId'),
  testTelegram: document.getElementById('testTelegram'),
  telegramStatus: document.getElementById('telegramStatus'),
  telegramToggleLabel: document.getElementById('telegramToggleLabel'),

  alertOverlay: document.getElementById('alertOverlay'),
  alertMessage: document.getElementById('alertMessage'),
  stopAlert: document.getElementById('stopAlert')
};

function getDefaults() {
  return {
    isActive: false,
    interval: 30,
    stochastic: false,
    minLimit: 5,
    distribution: 'uniform',
    contentWatch: {
      enabled: false,
      selector: '',
      lastValue: null,
      alertMode: 'increase',
      threshold: 0,
      alertSound: 'siren',
      alertVolume: 80
    },
    textWatch: {
      enabled: false,
      selector: '',
      sourceMode: 'selectorText',
      detectMode: 'keywords',
      keywords: [],
      lastMatchedKeywords: [],
      debugEnabled: false,
      alertSound: 'chime',
      alertVolume: 80
    },
    alertRouting: {
      mode: 'shared',
      sharedSound: 'siren',
      sharedVolume: 80
    },
    stopOnClick: false
  };
}

let currentTabId = null;
let currentTabUrl = null;
let tabSettings = getDefaults();
let refreshStatePoll = null;
let saveSettingsDebounce = null;

function t(key, fallback = '') {
  return window.i18n?.t ? window.i18n.t(key, fallback) : (fallback || key);
}

function getUiLocale() {
  const lang = window.i18n?.getCurrentLang?.() || 'en';
  return lang === 'pt' ? 'pt-BR' : lang;
}

async function init() {
  try {
    await window.i18n.init();
    window.i18n.createLanguageSelector(document.getElementById('languageSelector'));
  } catch (error) {
    console.error('i18n initialization failed:', error);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  currentTabUrl = tab.url;

  await loadTabSettings();
  setupEventListeners();
  await loadUrlLists();
  await loadTelegramSettings();
  updateUI();
  startStatePolling();

  const versionEl = document.getElementById('versionText');
  if (versionEl) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }
}

function migrateTextWatch(response = {}) {
  if (response.textWatch) {
    return {
      ...getDefaults().textWatch,
      ...response.textWatch,
      keywords: Array.isArray(response.textWatch.keywords) ? response.textWatch.keywords : [],
      lastMatchedKeywords: Array.isArray(response.textWatch.lastMatchedKeywords) ? response.textWatch.lastMatchedKeywords : []
    };
  }

  const legacyKeywordWatch = response.keywordWatch || {};
  const legacyContentWatch = response.contentWatch || {};
  const legacySourceMode = legacyKeywordWatch.sourceMode || 'auto';

  let sourceMode = 'selectorText';
  if (legacySourceMode === 'pageText') {
    sourceMode = 'pageText';
  } else if (legacySourceMode === 'pageHtml') {
    sourceMode = 'pageHtml';
  } else if (!legacyContentWatch.selector) {
    sourceMode = 'pageText';
  }

  return {
    ...getDefaults().textWatch,
    enabled: Boolean(legacyKeywordWatch.enabled),
    selector: sourceMode === 'selectorText' ? (legacyContentWatch.selector || '') : '',
    sourceMode,
    detectMode: 'keywords',
    keywords: Array.isArray(legacyKeywordWatch.keywords) ? legacyKeywordWatch.keywords : [],
    lastMatchedKeywords: [],
    alertSound: legacyContentWatch.alertSound || 'chime',
    alertVolume: legacyContentWatch.alertVolume ?? 80
  };
}

function migrateAlertRouting(response = {}) {
  if (response.alertRouting) {
    return {
      ...getDefaults().alertRouting,
      ...response.alertRouting
    };
  }

  const legacyContentWatch = response.contentWatch || {};
  return {
    mode: 'shared',
    sharedSound: legacyContentWatch.alertSound || 'siren',
    sharedVolume: legacyContentWatch.alertVolume ?? 80
  };
}

async function loadTabSettings() {
  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_SETTINGS',
    tabId: currentTabId
  });

  const defaults = getDefaults();
  tabSettings = {
    ...defaults,
    ...(response || {}),
    contentWatch: {
      ...defaults.contentWatch,
      ...(response?.contentWatch || {})
    },
    textWatch: migrateTextWatch(response),
    alertRouting: migrateAlertRouting(response)
  };
}

function updateUI() {
  updateStatusUI();
  updateTimerUI();
  updateNumericUI();
  updateTextUI();
  updateAlertRoutingUI();
}

function updateStatusUI() {
  const active = Boolean(tabSettings.isActive);
  elements.statusIndicator.classList.toggle('active', active);
  elements.statusText.textContent = active ? window.i18n.t('status.active') : window.i18n.t('status.inactive');
  elements.toggleRefresh.classList.toggle('active', active);
  elements.toggleRefresh.querySelector('.btn-text').textContent = active ? window.i18n.t('timer.stop') : window.i18n.t('timer.start');
  elements.toggleRefresh.querySelector('.btn-icon').textContent = active ? '||' : '>';
}

function isElementBeingEdited(element) {
  return document.activeElement === element;
}

function updateTimerUI() {
  if (!isElementBeingEdited(elements.intervalInput)) {
    elements.intervalInput.value = tabSettings.interval;
  }
  if (!isElementBeingEdited(elements.stochasticMode)) {
    elements.stochasticMode.checked = tabSettings.stochastic;
  }
  elements.stochasticOptions.classList.toggle('visible', Boolean(tabSettings.stochastic));
  if (!isElementBeingEdited(elements.minLimit)) {
    elements.minLimit.value = tabSettings.minLimit;
  }
  elements.distributionRadios.forEach((radio) => {
    if (!isElementBeingEdited(radio)) {
      radio.checked = radio.value === tabSettings.distribution;
    }
  });
  if (!isElementBeingEdited(elements.stopOnClick)) {
    elements.stopOnClick.checked = Boolean(tabSettings.stopOnClick);
  }
}

function updateNumericUI() {
  const numeric = tabSettings.contentWatch;
  if (!isElementBeingEdited(elements.contentWatchEnabled)) {
    elements.contentWatchEnabled.checked = Boolean(numeric.enabled);
  }
  elements.contentWatchOptions.classList.toggle('visible', Boolean(numeric.enabled));
  if (!isElementBeingEdited(elements.cssSelector)) {
    elements.cssSelector.value = numeric.selector || '';
  }
  elements.selectedValue.textContent = numeric.selector || window.i18n.t('contentWatch.none');
  elements.currentValue.textContent = numeric.lastValue ?? '--';
  if (!isElementBeingEdited(elements.alertMode)) {
    elements.alertMode.value = numeric.alertMode || 'increase';
  }
  if (!isElementBeingEdited(elements.thresholdValue)) {
    elements.thresholdValue.value = numeric.threshold ?? 0;
  }
  elements.thresholdGroup.classList.toggle('hidden', !['above', 'below'].includes(elements.alertMode.value));
  if (!isElementBeingEdited(elements.numericAlertSound)) {
    elements.numericAlertSound.value = numeric.alertSound || 'siren';
  }
  if (!isElementBeingEdited(elements.numericAlertVolume)) {
    setVolumeUI(elements.numericAlertVolume, elements.numericAlertVolumeValue, numeric.alertVolume ?? 80);
  }
}

function updateTextUI() {
  const textWatch = tabSettings.textWatch;
  if (!isElementBeingEdited(elements.textWatchEnabled)) {
    elements.textWatchEnabled.checked = Boolean(textWatch.enabled);
  }
  elements.textWatchOptions.classList.toggle('visible', Boolean(textWatch.enabled));
  if (!isElementBeingEdited(elements.textSourceMode)) {
    elements.textSourceMode.value = textWatch.sourceMode || 'selectorText';
  }
  if (!isElementBeingEdited(elements.textCssSelector)) {
    elements.textCssSelector.value = textWatch.selector || '';
  }
  elements.textSelectedValue.textContent = textWatch.selector || window.i18n.t('textWatch.none');
  elements.textCurrentPreview.textContent = textWatch.previewText || '--';
  if (!isElementBeingEdited(elements.textAlertMode)) {
    elements.textAlertMode.value = textWatch.detectMode || 'keywords';
  }
  if (!isElementBeingEdited(elements.textKeywordList)) {
    elements.textKeywordList.value = (textWatch.keywords || []).join('\n');
  }
  if (!isElementBeingEdited(elements.textDebugEnabled)) {
    elements.textDebugEnabled.checked = Boolean(textWatch.debugEnabled);
  }
  if (!isElementBeingEdited(elements.textAlertSound)) {
    elements.textAlertSound.value = textWatch.alertSound || 'chime';
  }
  if (!isElementBeingEdited(elements.textAlertVolume)) {
    setVolumeUI(elements.textAlertVolume, elements.textAlertVolumeValue, textWatch.alertVolume ?? 80);
  }
  updateTextSourceControls();
}

function updateAlertRoutingUI() {
  const alertRouting = tabSettings.alertRouting;
  const isShared = (alertRouting.mode || 'shared') === 'shared';
  if (!isElementBeingEdited(elements.alertRoutingMode)) {
    elements.alertRoutingMode.value = isShared ? 'shared' : 'separate';
  }
  elements.sharedAlertSettings.classList.toggle('hidden', !isShared);
  elements.numericAlertSettings.classList.toggle('hidden', isShared);
  elements.textAlertSettings.classList.toggle('hidden', isShared);
  if (!isElementBeingEdited(elements.sharedAlertSound)) {
    elements.sharedAlertSound.value = alertRouting.sharedSound || 'siren';
  }
  if (!isElementBeingEdited(elements.sharedAlertVolume)) {
    setVolumeUI(elements.sharedAlertVolume, elements.sharedAlertVolumeValue, alertRouting.sharedVolume ?? 80);
  }
}

function updateTextSourceControls() {
  const showSelectorControls = elements.textSourceMode.value === 'selectorText';
  elements.textSelectorControls.classList.toggle('hidden', !showSelectorControls);
}

function setVolumeUI(input, valueLabel, volume) {
  input.value = volume;
  valueLabel.textContent = `${volume}%`;
}

function setupEventListeners() {
  elements.toggleRefresh.addEventListener('click', toggleRefresh);
  elements.intervalInput.addEventListener('change', saveSettings);
  elements.intervalInput.addEventListener('input', scheduleSaveSettings);

  elements.stochasticMode.addEventListener('change', () => {
    elements.stochasticOptions.classList.toggle('visible', elements.stochasticMode.checked);
    saveSettings();
  });
  elements.minLimit.addEventListener('change', saveSettings);
  elements.minLimit.addEventListener('input', scheduleSaveSettings);
  elements.distributionRadios.forEach((radio) => radio.addEventListener('change', saveSettings));

  elements.alertRoutingMode.addEventListener('change', () => {
    updateAlertRoutingUIFromInputs();
    saveSettings();
  });
  elements.sharedAlertSound.addEventListener('change', saveSettings);
  elements.sharedAlertVolume.addEventListener('input', () => setVolumeUI(elements.sharedAlertVolume, elements.sharedAlertVolumeValue, elements.sharedAlertVolume.value));
  elements.sharedAlertVolume.addEventListener('change', saveSettings);
  elements.previewSharedSound.addEventListener('click', () => previewSound(elements.sharedAlertSound.value, elements.sharedAlertVolume.value));

  elements.contentWatchEnabled.addEventListener('change', () => {
    elements.contentWatchOptions.classList.toggle('visible', elements.contentWatchEnabled.checked);
    saveSettings();
  });
  elements.pickerModeBtn.addEventListener('click', () => toggleSelectorMode('numeric', 'picker'));
  elements.advancedModeBtn.addEventListener('click', () => toggleSelectorMode('numeric', 'advanced'));
  elements.startPicker.addEventListener('click', () => startElementPicker('numeric'));
  elements.testSelector.addEventListener('click', () => testCssSelector('numeric'));
  elements.cssSelector.addEventListener('change', saveSettings);
  elements.alertMode.addEventListener('change', () => {
    elements.thresholdGroup.classList.toggle('hidden', !['above', 'below'].includes(elements.alertMode.value));
    saveSettings();
  });
  elements.thresholdValue.addEventListener('change', saveSettings);
  elements.thresholdValue.addEventListener('input', scheduleSaveSettings);
  elements.numericAlertSound.addEventListener('change', saveSettings);
  elements.numericAlertVolume.addEventListener('input', () => setVolumeUI(elements.numericAlertVolume, elements.numericAlertVolumeValue, elements.numericAlertVolume.value));
  elements.numericAlertVolume.addEventListener('change', saveSettings);
  elements.previewNumericSound.addEventListener('click', () => previewSound(elements.numericAlertSound.value, elements.numericAlertVolume.value));

  elements.textWatchEnabled.addEventListener('change', () => {
    elements.textWatchOptions.classList.toggle('visible', elements.textWatchEnabled.checked);
    saveSettings();
  });
  elements.textSourceMode.addEventListener('change', () => {
    updateTextSourceControls();
    saveSettings();
  });
  elements.textPickerModeBtn.addEventListener('click', () => toggleSelectorMode('text', 'picker'));
  elements.textAdvancedModeBtn.addEventListener('click', () => toggleSelectorMode('text', 'advanced'));
  elements.textStartPicker.addEventListener('click', () => startElementPicker('text'));
  elements.textTestSelector.addEventListener('click', () => testCssSelector('text'));
  elements.textCssSelector.addEventListener('change', saveSettings);
  elements.textAlertMode.addEventListener('change', saveSettings);
  elements.textKeywordList.addEventListener('change', saveSettings);
  elements.textKeywordList.addEventListener('input', scheduleSaveSettings);
  elements.textDebugEnabled.addEventListener('change', saveSettings);
  elements.textAlertSound.addEventListener('change', saveSettings);
  elements.textAlertVolume.addEventListener('input', () => setVolumeUI(elements.textAlertVolume, elements.textAlertVolumeValue, elements.textAlertVolume.value));
  elements.textAlertVolume.addEventListener('change', saveSettings);
  elements.previewTextSound.addEventListener('click', () => previewSound(elements.textAlertSound.value, elements.textAlertVolume.value));

  elements.stopOnClick.addEventListener('change', saveSettings);

  elements.blacklistToggle.addEventListener('click', () => {
    const section = elements.blacklistToggle.closest('.collapsible');
    section.classList.toggle('collapsed');
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      elements.tabs.forEach((item) => item.classList.remove('active'));
      elements.tabContents.forEach((content) => content.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tabName}Tab`).classList.add('active');
    });
  });

  elements.addBlacklist.addEventListener('click', () => addUrl('blacklist'));
  elements.addWhitelist.addEventListener('click', () => addUrl('whitelist'));
  elements.blacklistUrl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') addUrl('blacklist');
  });
  elements.whitelistUrl.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') addUrl('whitelist');
  });

  elements.telegramEnabled.addEventListener('change', () => {
    elements.telegramOptions.classList.toggle('hidden', !elements.telegramEnabled.checked);
    saveTelegramSettings();
  });
  elements.telegramToggleLabel.addEventListener('click', (event) => event.stopPropagation());
  elements.telegramBotToken.addEventListener('change', saveTelegramSettings);
  elements.telegramChatId.addEventListener('change', saveTelegramSettings);
  elements.testTelegram.addEventListener('click', testTelegramNotification);

  elements.stopAlert.addEventListener('click', stopAlert);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'ALERT_TRIGGERED') {
      showAlertOverlay(message.message);
    }

    if (message.type === 'SELECTOR_UPDATED' && message.tabId === currentTabId) {
      handleSelectorUpdated(message);
    }

    if (message.type === 'TIMER_PAUSED' && message.tabId === currentTabId) {
      tabSettings.isActive = false;
      updateUI();
    }
  });
}

function updateAlertRoutingUIFromInputs() {
  const isShared = elements.alertRoutingMode.value === 'shared';
  elements.sharedAlertSettings.classList.toggle('hidden', !isShared);
  elements.numericAlertSettings.classList.toggle('hidden', isShared);
  elements.textAlertSettings.classList.toggle('hidden', isShared);
}

function handleSelectorUpdated(message) {
  if (message.watchType === 'text') {
    tabSettings.textWatch = {
      ...tabSettings.textWatch,
      enabled: true,
      selector: message.selector,
      previewText: message.previewText || tabSettings.textWatch.previewText || ''
    };
    elements.textSelectedValue.textContent = message.selector;
    elements.textCssSelector.value = message.selector;
    if (message.previewText) {
      elements.textCurrentPreview.textContent = message.previewText;
    }
  } else {
    tabSettings.contentWatch = {
      ...tabSettings.contentWatch,
      enabled: true,
      selector: message.selector,
      lastValue: message.value
    };
    elements.selectedValue.textContent = message.selector;
    elements.cssSelector.value = message.selector;
    elements.currentValue.textContent = message.value ?? '--';
  }

  updateUI();
}

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

function startStatePolling() {
  if (refreshStatePoll) {
    clearInterval(refreshStatePoll);
  }

  refreshStatePoll = window.setInterval(async () => {
    if (!currentTabId) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TAB_SETTINGS',
        tabId: currentTabId
      });
      if (!response) {
        return;
      }

      tabSettings.isActive = Boolean(response.isActive);
      if (response.contentWatch) {
        tabSettings.contentWatch = {
          ...tabSettings.contentWatch,
          lastValue: response.contentWatch.lastValue ?? tabSettings.contentWatch.lastValue
        };
      }
      if (response.textWatch) {
        tabSettings.textWatch = {
          ...tabSettings.textWatch,
          previewText: response.textWatch.previewText ?? tabSettings.textWatch.previewText
        };
      }

      updateStatusUI();
      elements.currentValue.textContent = tabSettings.contentWatch.lastValue ?? '--';
      elements.textCurrentPreview.textContent = tabSettings.textWatch.previewText || '--';
    } catch {
      // Ignore transient popup polling errors.
    }
  }, 1500);
}

function scheduleSaveSettings() {
  if (saveSettingsDebounce) {
    clearTimeout(saveSettingsDebounce);
  }

  saveSettingsDebounce = window.setTimeout(() => {
    saveSettings().catch(() => { });
  }, 300);
}

function getSettingsFromUI() {
  const distribution = Array.from(elements.distributionRadios).find((radio) => radio.checked)?.value || 'uniform';
  const keywords = elements.textKeywordList.value
    .split(/\r?\n|,/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);

  return {
    isActive: tabSettings.isActive,
    interval: parseInt(elements.intervalInput.value, 10) || 30,
    stochastic: elements.stochasticMode.checked,
    minLimit: parseInt(elements.minLimit.value, 10) || 5,
    distribution,
    contentWatch: {
      enabled: elements.contentWatchEnabled.checked,
      selector: elements.cssSelector.value.trim(),
      lastValue: tabSettings.contentWatch?.lastValue ?? null,
      alertMode: elements.alertMode.value || 'increase',
      threshold: parseInt(elements.thresholdValue.value, 10) || 0,
      alertSound: elements.numericAlertSound.value || 'siren',
      alertVolume: parseInt(elements.numericAlertVolume.value, 10) || 80
    },
    textWatch: {
      enabled: elements.textWatchEnabled.checked,
      selector: elements.textCssSelector.value.trim(),
      sourceMode: elements.textSourceMode.value || 'selectorText',
      detectMode: elements.textAlertMode.value || 'keywords',
      keywords,
      lastMatchedKeywords: tabSettings.textWatch?.lastMatchedKeywords || [],
      debugEnabled: elements.textDebugEnabled.checked,
      previewText: tabSettings.textWatch?.previewText || '',
      alertSound: elements.textAlertSound.value || 'chime',
      alertVolume: parseInt(elements.textAlertVolume.value, 10) || 80
    },
    alertRouting: {
      mode: elements.alertRoutingMode.value || 'shared',
      sharedSound: elements.sharedAlertSound.value || 'siren',
      sharedVolume: parseInt(elements.sharedAlertVolume.value, 10) || 80
    },
    stopOnClick: elements.stopOnClick.checked
  };
}

async function saveSettings() {
  const settings = getSettingsFromUI();
  tabSettings = {
    ...tabSettings,
    ...settings,
    contentWatch: settings.contentWatch,
    textWatch: settings.textWatch,
    alertRouting: settings.alertRouting
  };

  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    tabId: currentTabId,
    tabUrl: currentTabUrl,
    settings
  });
}

function toggleSelectorMode(watchType, mode) {
  const isText = watchType === 'text';
  const pickerBtn = isText ? elements.textPickerModeBtn : elements.pickerModeBtn;
  const advancedBtn = isText ? elements.textAdvancedModeBtn : elements.advancedModeBtn;
  const pickerMode = isText ? elements.textPickerMode : elements.pickerMode;
  const advancedMode = isText ? elements.textAdvancedMode : elements.advancedMode;

  const showPicker = mode === 'picker';
  pickerBtn.classList.toggle('active', showPicker);
  advancedBtn.classList.toggle('active', !showPicker);
  pickerMode.classList.toggle('hidden', !showPicker);
  advancedMode.classList.toggle('hidden', showPicker);
}

async function startElementPicker(watchType) {
  await chrome.tabs.sendMessage(currentTabId, { type: 'START_PICKER', watchType });
  window.close();
}

async function testCssSelector(watchType) {
  const selector = watchType === 'text' ? elements.textCssSelector.value.trim() : elements.cssSelector.value.trim();
  if (!selector) return;

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, {
      type: 'TEST_SELECTOR',
      selector
    });

    if (!response.success) {
      if (watchType === 'text') {
        elements.textCurrentPreview.textContent = window.i18n.t('contentWatch.error');
      } else {
        elements.currentValue.textContent = window.i18n.t('contentWatch.error');
      }
      return;
    }

    if (watchType === 'text') {
      const preview = response.value || '--';
      elements.textCurrentPreview.textContent = preview;
      tabSettings.textWatch.previewText = preview;
      await saveSettings();
    } else {
      elements.currentValue.textContent = response.numericValue ?? '--';
      tabSettings.contentWatch.lastValue = response.numericValue ?? null;
      await saveSettings();
    }
  } catch (error) {
    if (watchType === 'text') {
      elements.textCurrentPreview.textContent = window.i18n.t('contentWatch.error');
    } else {
      elements.currentValue.textContent = window.i18n.t('contentWatch.error');
    }
  }
}

async function previewSound(soundType, volume) {
  await chrome.runtime.sendMessage({
    type: 'PREVIEW_SOUND',
    soundType: soundType || 'siren',
    volume: (parseInt(volume, 10) || 80) / 100
  });
}

function showAlertOverlay(message) {
  if (message) {
    elements.alertMessage.textContent = message;
  }
  elements.alertOverlay.classList.remove('hidden');
}

async function stopAlert() {
  elements.alertOverlay.classList.add('hidden');
  await chrome.runtime.sendMessage({ type: 'STOP_ALERT' });
}

async function loadUrlLists() {
  const result = await chrome.storage.sync.get(['urlBlacklist', 'urlWhitelist']);
  renderUrlList(elements.blacklistList, result.urlBlacklist || [], 'blacklist');
  renderUrlList(elements.whitelistList, result.urlWhitelist || [], 'whitelist');
}

function renderUrlList(container, urls, type) {
  container.innerHTML = '';
  urls.forEach((url) => {
    const item = document.createElement('li');
    item.innerHTML = `
      <span>${url}</span>
      <button data-url="${url}" data-type="${type}">x</button>
    `;
    item.querySelector('button').addEventListener('click', (event) => {
      removeUrl(event.target.dataset.type, event.target.dataset.url);
    });
    container.appendChild(item);
  });
}

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
  }
  input.value = '';
  await loadUrlLists();
}

async function removeUrl(type, url) {
  const key = type === 'blacklist' ? 'urlBlacklist' : 'urlWhitelist';
  const result = await chrome.storage.sync.get([key]);
  const urls = (result[key] || []).filter((item) => item !== url);
  await chrome.storage.sync.set({ [key]: urls });
  await loadUrlLists();
}

async function loadTelegramSettings() {
  const result = await chrome.storage.sync.get(['telegramSettings']);
  const settings = result.telegramSettings || { enabled: false, botToken: '', chatId: '' };
  elements.telegramEnabled.checked = settings.enabled;
  elements.telegramBotToken.value = settings.botToken || '';
  elements.telegramChatId.value = settings.chatId || '';
  elements.telegramOptions.classList.toggle('hidden', !settings.enabled);
  await loadLastTelegramStatus();
}

async function saveTelegramSettings() {
  await chrome.storage.sync.set({
    telegramSettings: {
      enabled: elements.telegramEnabled.checked,
      botToken: elements.telegramBotToken.value.trim(),
      chatId: elements.telegramChatId.value.trim()
    }
  });
}

async function testTelegramNotification() {
  const botToken = elements.telegramBotToken.value.trim();
  const chatId = elements.telegramChatId.value.trim();

  if (!botToken || !chatId) {
    showTelegramStatus('error', t('telegram_testMissingCredentials', 'Insert Bot Token and Chat ID'));
    return;
  }

  showTelegramStatus('loading', t('telegram_testSending', 'Sending...'));

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: t('telegram_testMessage', 'Auto Refresh & Page Monitor\n\nTelegram test completed successfully.'),
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();
    if (data.ok) {
      showTelegramStatus('success', t('telegram_testSuccess', 'Notification sent successfully'));
    } else {
      showTelegramStatus('error', `Error: ${data.description || t('telegram_statusUnknownError', 'Unknown error')}`);
    }
  } catch (error) {
    showTelegramStatus('error', `${t('telegram_statusNetworkError', 'Network error')}: ${error.message}`);
  }
}

async function loadLastTelegramStatus() {
  const result = await chrome.storage.local.get(['telegramLastStatus']);
  const status = result.telegramLastStatus;
  const statusEl = document.getElementById('lastNotificationStatus');
  if (!statusEl) return;

  if (!status) {
    statusEl.classList.add('hidden');
    return;
  }

  statusEl.classList.remove('hidden', 'success', 'error');
  statusEl.classList.add(status.success ? 'success' : 'error');
  const date = new Date(status.time).toLocaleString(getUiLocale());
  const prefix = status.success ? 'OK' : 'ERR';
  const text = status.success
    ? (status.message
      || (status.messageKey ? t(status.messageKey, 'Sent successfully') : t('telegram_statusSentSuccessfully', 'Sent successfully')))
    : (status.error || t('telegram_statusFailed', 'Failed'));
  statusEl.innerHTML = `
    <span class="time">${date}</span>
    <div class="message">${prefix} ${t('telegram_statusAutomaticLast', 'Last automatic Telegram event')}: ${text}</div>
  `;
}

function showTelegramStatus(type, message) {
  elements.telegramStatus.textContent = message;
  elements.telegramStatus.className = `telegram-status ${type}`;
  elements.telegramStatus.classList.remove('hidden');

  if (type === 'success') {
    setTimeout(() => {
      elements.telegramStatus.classList.add('hidden');
    }, 3000);
  }
}

init();
