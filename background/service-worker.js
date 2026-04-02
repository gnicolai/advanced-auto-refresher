/**
 * Auto Refresh & Page Monitor with Telegram Alerts - Background Service Worker
 * Manages MV3-safe refresh scheduling, alerting, and tab lifecycle state.
 */

const tabStates = new Map();
const badgeIntervals = new Map();
const notificationTargets = new Map();

const STORAGE_KEYS = {
    tabStatesByTabId: 'tabStatesByTabId',
    restorableActiveTimers: 'restorableActiveTimers'
};

const REFRESH_ALARM_PREFIX = 'refresh_';
const RECOVERY_ALARM_PREFIX = 'refresh_recovery_';
const NOTIFICATION_ID_PREFIX = 'aar_alert_';
const NOTIFICATION_ICON_URL = 'assets/icon128.png';

const RUNTIME_LANGUAGE_MAP = {
    ar: { folder: 'ar', locale: 'ar' },
    de: { folder: 'de', locale: 'de' },
    en: { folder: 'en', locale: 'en' },
    es: { folder: 'es', locale: 'es' },
    fr: { folder: 'fr', locale: 'fr' },
    it: { folder: 'it', locale: 'it' },
    pl: { folder: 'pl', locale: 'pl' },
    pt: { folder: 'pt_BR', locale: 'pt-BR' },
    pt_BR: { folder: 'pt_BR', locale: 'pt-BR' },
    uk: { folder: 'uk', locale: 'uk' }
};

const runtimeTranslationCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
    console.log('Auto Refresh & Page Monitor installed');

    const result = await chrome.storage.sync.get(['globalSettings']);
    if (!result.globalSettings) {
        await chrome.storage.sync.set({
            globalSettings: {
                defaultMinLimit: 5,
                defaultDistribution: 'uniform'
            },
            urlBlacklist: [],
            urlWhitelist: []
        });
    }

    await restoreTimers();
});

chrome.runtime.onStartup.addListener(async () => {
    await restoreTimers();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
        .then(sendResponse)
        .catch((error) => {
            console.error('Message handling failed:', error);
            sendResponse({ success: false, error: error.message || 'Unknown error' });
        });
    return true;
});

async function handleMessage(message, sender) {
    switch (message.type) {
        case 'GET_TAB_SETTINGS':
            return getTabSettings(message.tabId);

        case 'TOGGLE_REFRESH':
            return toggleRefresh(message.tabId, message.tabUrl, message.settings);

        case 'UPDATE_SETTINGS':
            return updateSettings(message.tabId, message.tabUrl, message.settings);

        case 'STOP_ALERT':
            stopAlertSound();
            return { success: true };

        case 'PREVIEW_SOUND':
            await playAlertSound(message.soundType || 'siren', message.volume ?? 0.8, { interrupt: true });
            return { success: true };

        case 'AUDIO_ENDED':
            return { success: true };

        case 'SELECTOR_PICKED':
            return handleSelectorPicked(
                sender.tab?.id,
                sender.tab?.url,
                message.watchType || 'numeric',
                message.selector,
                message.value,
                message.previewText
            );

        case 'USER_PAGE_CLICK':
            return handleUserPageClick(sender.tab?.id);

        default:
            return null;
    }
}

function getDefaultTabSettings(tabUrl = '') {
    return {
        isActive: false,
        interval: 30,
        stochastic: false,
        minLimit: 5,
        distribution: 'uniform',
        tabUrl,
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
            keywords: [],
            lastMatchedKeywords: [],
            sourceMode: 'selectorText',
            detectMode: 'keywords',
            debugEnabled: false,
            previewText: '',
            alertSound: 'chime',
            alertVolume: 80
        },
        alertRouting: {
            mode: 'shared',
            sharedSound: 'siren',
            sharedVolume: 80
        },
        stopOnClick: false,
        schedule: {
            nextRefreshAt: null,
            lastScheduledIntervalMs: null,
            lastRefreshAt: null
        },
        pendingRefresh: null
    };
}

function normalizeKeywords(keywords) {
    if (!Array.isArray(keywords)) {
        return [];
    }

    return keywords
        .map((keyword) => String(keyword || '').trim())
        .filter(Boolean);
}

function normalizeTextWatch(settings = {}, defaults, legacyContentWatch = {}, legacyKeywordWatch = {}) {
    if (settings.textWatch) {
        return {
            ...defaults.textWatch,
            ...settings.textWatch,
            keywords: normalizeKeywords(settings.textWatch.keywords),
            lastMatchedKeywords: normalizeKeywords(settings.textWatch.lastMatchedKeywords)
        };
    }

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
        ...defaults.textWatch,
        enabled: Boolean(legacyKeywordWatch.enabled),
        selector: sourceMode === 'selectorText' ? (legacyContentWatch.selector || '') : '',
        keywords: normalizeKeywords(legacyKeywordWatch.keywords),
        lastMatchedKeywords: [],
        sourceMode,
        detectMode: 'keywords',
        alertSound: legacyContentWatch.alertSound || defaults.textWatch.alertSound,
        alertVolume: legacyContentWatch.alertVolume ?? defaults.textWatch.alertVolume
    };
}

function normalizeAlertRouting(settings = {}, defaults, legacyContentWatch = {}) {
    if (settings.alertRouting) {
        return {
            ...defaults.alertRouting,
            ...settings.alertRouting
        };
    }

    return {
        ...defaults.alertRouting,
        mode: 'shared',
        sharedSound: legacyContentWatch.alertSound || defaults.alertRouting.sharedSound,
        sharedVolume: legacyContentWatch.alertVolume ?? defaults.alertRouting.sharedVolume
    };
}

function normalizeSettings(settings = {}, tabUrl = settings.tabUrl || '') {
    const defaults = getDefaultTabSettings(tabUrl);
    const legacyContentWatch = settings.contentWatch || {};
    const legacyKeywordWatch = settings.keywordWatch || {};
    const normalized = {
        ...defaults,
        ...settings,
        tabUrl: tabUrl || settings.tabUrl || '',
        contentWatch: {
            ...defaults.contentWatch,
            ...legacyContentWatch
        },
        textWatch: normalizeTextWatch(settings, defaults, legacyContentWatch, legacyKeywordWatch),
        alertRouting: normalizeAlertRouting(settings, defaults, legacyContentWatch),
        schedule: {
            ...defaults.schedule,
            ...(settings.schedule || {})
        },
        pendingRefresh: settings.pendingRefresh || null
    };

    normalized.interval = Math.max(1, parseInt(normalized.interval, 10) || defaults.interval);
    normalized.minLimit = Math.max(1, parseInt(normalized.minLimit, 10) || defaults.minLimit);
    normalized.contentWatch.threshold = parseInt(normalized.contentWatch.threshold, 10) || 0;
    normalized.contentWatch.alertVolume = Math.max(0, Math.min(100, parseInt(normalized.contentWatch.alertVolume, 10) || defaults.contentWatch.alertVolume));
    normalized.contentWatch.lastValue = normalized.contentWatch.lastValue === null || normalized.contentWatch.lastValue === undefined
        ? null
        : Number.isFinite(Number(normalized.contentWatch.lastValue))
            ? Number(normalized.contentWatch.lastValue)
            : null;
    normalized.textWatch.keywords = normalizeKeywords(normalized.textWatch.keywords);
    normalized.textWatch.lastMatchedKeywords = normalizeKeywords(normalized.textWatch.lastMatchedKeywords);
    normalized.textWatch.sourceMode = ['selectorText', 'pageText', 'pageHtml'].includes(normalized.textWatch.sourceMode)
        ? normalized.textWatch.sourceMode
        : 'selectorText';
    normalized.textWatch.detectMode = ['change', 'keywords', 'keywordState', 'changeOrKeywords'].includes(normalized.textWatch.detectMode)
        ? normalized.textWatch.detectMode
        : 'keywords';
    normalized.textWatch.debugEnabled = Boolean(normalized.textWatch.debugEnabled);
    normalized.textWatch.alertVolume = Math.max(0, Math.min(100, parseInt(normalized.textWatch.alertVolume, 10) || defaults.textWatch.alertVolume));
    normalized.alertRouting.mode = ['shared', 'separate'].includes(normalized.alertRouting.mode)
        ? normalized.alertRouting.mode
        : 'shared';
    normalized.alertRouting.sharedVolume = Math.max(0, Math.min(100, parseInt(normalized.alertRouting.sharedVolume, 10) || defaults.alertRouting.sharedVolume));
    normalized.stopOnClick = Boolean(normalized.stopOnClick);
    normalized.isActive = Boolean(normalized.isActive);

    return normalized;
}

async function getTabSettings(tabId) {
    if (tabStates.has(tabId)) {
        return tabStates.get(tabId);
    }

    try {
        const result = await chrome.storage.local.get([STORAGE_KEYS.tabStatesByTabId]);
        const savedStates = result[STORAGE_KEYS.tabStatesByTabId] || {};
        if (savedStates[tabId]) {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            const normalized = normalizeSettings(savedStates[tabId], tab?.url || savedStates[tabId].tabUrl || '');
            tabStates.set(tabId, normalized);
            if (normalized.isActive) {
                startBadgeCountdown(tabId, normalized);
            }
            return normalized;
        }
    } catch (error) {
        console.log('Could not load tab settings from storage:', error);
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const defaults = getDefaultTabSettings(tab?.url || '');
    tabStates.set(tabId, defaults);
    return defaults;
}

async function toggleRefresh(tabId, tabUrl, settings) {
    const existing = await getTabSettings(tabId);
    const nextState = normalizeSettings({ ...existing, ...settings, isActive: Boolean(settings.isActive) }, tabUrl);

    if (nextState.isActive) {
        await primeMonitoringState(tabId, nextState);
        await startTimer(tabId, nextState);
    } else {
        const pausedState = await pauseTimer(tabId, { keepState: true });
        const mergedState = normalizeSettings({
            ...pausedState,
            ...nextState,
            isActive: false,
            pendingRefresh: null,
            schedule: {
                ...pausedState.schedule,
                nextRefreshAt: null
            }
        }, tabUrl);
        tabStates.set(tabId, mergedState);
        await saveTabStates();
        await syncContentScriptState(tabId, mergedState);
    }

    return { success: true };
}

async function updateSettings(tabId, tabUrl, settings) {
    const existing = await getTabSettings(tabId);
    const nextState = normalizeSettings({ ...existing, ...settings }, tabUrl);

    tabStates.set(tabId, nextState);

    if (nextState.isActive) {
        await primeMonitoringState(tabId, nextState);
        await scheduleNextRefresh(tabId, nextState, { resetAlarm: true });
    } else {
        await clearRefreshAlarm(tabId);
        clearBadgeCountdown(tabId);
        nextState.pendingRefresh = null;
        nextState.schedule.nextRefreshAt = null;
        tabStates.set(tabId, nextState);
    }

    await saveTabStates();
    await syncContentScriptState(tabId, nextState);
    return { success: true };
}

async function restoreTimers() {
    const result = await chrome.storage.local.get([
        STORAGE_KEYS.tabStatesByTabId,
        STORAGE_KEYS.restorableActiveTimers
    ]);

    const savedByTabId = result[STORAGE_KEYS.tabStatesByTabId] || {};
    const restorableActiveTimers = Array.isArray(result[STORAGE_KEYS.restorableActiveTimers])
        ? result[STORAGE_KEYS.restorableActiveTimers]
        : [];
    const tabs = await chrome.tabs.query({});
    const usedRestorableIndexes = new Set();

    for (const tab of tabs) {
        if (!tab.id) {
            continue;
        }

        let restored = null;

        if (savedByTabId[tab.id]) {
            restored = normalizeSettings(savedByTabId[tab.id], tab.url || savedByTabId[tab.id].tabUrl || '');
        } else if (tab.url) {
            const index = restorableActiveTimers.findIndex((candidate, candidateIndex) => {
                if (usedRestorableIndexes.has(candidateIndex)) {
                    return false;
                }

                return candidate?.isActive && candidate?.tabUrl === tab.url;
            });

            if (index >= 0) {
                usedRestorableIndexes.add(index);
                restored = normalizeSettings(restorableActiveTimers[index], tab.url);
            }
        }

        if (!restored) {
            continue;
        }

        tabStates.set(tab.id, restored);

        if (restored.isActive) {
            await resumeTimer(tab.id, restored);
        }
    }

    await saveTabStates();
}

async function primeMonitoringState(tabId, state) {
    const needsNumericBaseline = state.contentWatch.enabled && state.contentWatch.selector && state.contentWatch.lastValue === null;
    if (!needsNumericBaseline) {
        return;
    }

    const snapshot = await captureMonitoringSnapshot(tabId, state);
    if (!snapshot.success || !snapshot.numeric?.success) {
        return;
    }

    state.contentWatch.lastValue = snapshot.numeric.numericValue;

    tabStates.set(tabId, state);
    await saveTabStates();
}

async function startTimer(tabId, state) {
    const nextState = normalizeSettings({ ...state, isActive: true, pendingRefresh: null }, state.tabUrl);
    tabStates.set(tabId, nextState);
    await scheduleNextRefresh(tabId, nextState, { resetAlarm: true });
    await syncContentScriptState(tabId, nextState);
}

async function resumeTimer(tabId, state) {
    const nextState = normalizeSettings(state, state.tabUrl);
    tabStates.set(tabId, nextState);

    const nextRefreshAt = Number(nextState.schedule?.nextRefreshAt) || 0;
    if (nextRefreshAt > Date.now()) {
        await createRefreshAlarm(tabId, nextRefreshAt - Date.now());
        startBadgeCountdown(tabId, nextState);
    } else {
        await scheduleNextRefresh(tabId, nextState, { resetAlarm: true });
    }

    await syncContentScriptState(tabId, nextState);
}

async function pauseTimer(tabId, { keepState = false, reason = 'manual' } = {}) {
    const existing = tabStates.get(tabId) || getDefaultTabSettings();
    const nextState = normalizeSettings({
        ...existing,
        isActive: false,
        pendingRefresh: null,
        schedule: {
            ...existing.schedule,
            nextRefreshAt: null
        }
    }, existing.tabUrl);

    await clearRefreshAlarm(tabId);
    clearBadgeCountdown(tabId);

    try {
        await chrome.action.setBadgeText({ text: '', tabId });
    } catch {
        // Ignore tabs that no longer exist.
    }

    if (keepState) {
        tabStates.set(tabId, nextState);
        await saveTabStates();
        await syncContentScriptState(tabId, nextState);
    } else {
        tabStates.delete(tabId);
        await saveTabStates();
    }

    chrome.runtime.sendMessage({
        type: 'TIMER_PAUSED',
        tabId,
        reason
    }).catch(() => { });

    return nextState;
}

async function handleUserPageClick(tabId) {
    if (!tabId) {
        return { success: false };
    }

    const state = await getTabSettings(tabId);
    if (!state.isActive || !state.stopOnClick) {
        return { success: false };
    }

    const pausedState = await pauseTimer(tabId, { keepState: true, reason: 'user-click' });
    const i18n = await getRuntimeI18nContext();
    await showPageSummary(tabId, i18n.t('clickStop_pausedToast', 'Auto-refresh paused after click.'));
    return { success: true, settings: pausedState };
}

async function scheduleNextRefresh(tabId, state, { resetAlarm = false } = {}) {
    const intervalMs = calculateNextInterval(state);
    const nextRefreshAt = Date.now() + intervalMs;
    const nextState = normalizeSettings({
        ...state,
        isActive: true,
        schedule: {
            ...state.schedule,
            nextRefreshAt,
            lastScheduledIntervalMs: intervalMs
        }
    }, state.tabUrl);

    tabStates.set(tabId, nextState);

    if (resetAlarm) {
        await clearRefreshAlarm(tabId);
    }

    await createRefreshAlarm(tabId, intervalMs);
    startBadgeCountdown(tabId, nextState);
    await saveTabStates();
    return nextState;
}

async function createRefreshAlarm(tabId, delayMs) {
    await chrome.alarms.create(`${REFRESH_ALARM_PREFIX}${tabId}`, {
        when: Date.now() + Math.max(1000, delayMs)
    });
}

async function createRecoveryAlarm(tabId, delayMs = 30000) {
    await chrome.alarms.create(`${RECOVERY_ALARM_PREFIX}${tabId}`, {
        when: Date.now() + Math.max(5000, delayMs)
    });
}

async function clearRefreshAlarm(tabId) {
    await chrome.alarms.clear(`${REFRESH_ALARM_PREFIX}${tabId}`);
}

async function clearRecoveryAlarm(tabId) {
    await chrome.alarms.clear(`${RECOVERY_ALARM_PREFIX}${tabId}`);
}

function calculateNextInterval(settings) {
    const target = settings.interval * 1000;
    const minLimit = settings.minLimit * 1000;

    if (!settings.stochastic) {
        return target;
    }

    return settings.distribution === 'gaussian'
        ? calculateGaussian(target, minLimit)
        : calculateUniform(target, minLimit);
}

function calculateUniform(target, minLimit) {
    const maxLimit = 2 * target - minLimit;
    const range = maxLimit - minLimit;
    const randomValue = minLimit + Math.random() * range;
    return Math.max(minLimit, Math.round(randomValue));
}

function calculateGaussian(target, minLimit) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const sigma = target * 0.25;
    let value = target + z0 * sigma;
    value = Math.max(minLimit, value);
    return Math.round(value);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith(RECOVERY_ALARM_PREFIX)) {
        const tabId = parseInt(alarm.name.replace(RECOVERY_ALARM_PREFIX, ''), 10);
        const state = await getTabSettings(tabId);
        if (!state?.isActive || !state.pendingRefresh) {
            await clearRecoveryAlarm(tabId);
            return;
        }

        const recoveredState = normalizeSettings({
            ...state,
            pendingRefresh: null
        }, state.tabUrl);

        tabStates.set(tabId, recoveredState);
        await saveTabStates();
        await scheduleNextRefresh(tabId, recoveredState, { resetAlarm: true });
        await syncContentScriptState(tabId, recoveredState);
        return;
    }

    if (!alarm.name.startsWith(REFRESH_ALARM_PREFIX)) {
        return;
    }

    const tabId = parseInt(alarm.name.replace(REFRESH_ALARM_PREFIX, ''), 10);
    const state = await getTabSettings(tabId);

    if (!state?.isActive) {
        await clearRefreshAlarm(tabId);
        return;
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
        tabStates.delete(tabId);
        clearBadgeCountdown(tabId);
        await saveTabStates();
        return;
    }

    state.tabUrl = tab.url || state.tabUrl;
    tabStates.set(tabId, state);

    const isBlacklisted = await checkBlacklist(state.tabUrl);
    if (isBlacklisted) {
        console.log('Tab is blacklisted, skipping refresh:', state.tabUrl);
        await scheduleNextRefresh(tabId, state, { resetAlarm: true });
        return;
    }

    const preSnapshot = await captureMonitoringSnapshot(tabId, state);
    const nextState = normalizeSettings({
        ...state,
        pendingRefresh: {
            startedAt: Date.now(),
            tabUrl: state.tabUrl,
            preSnapshot
        }
    }, state.tabUrl);

    tabStates.set(tabId, nextState);
    await saveTabStates();

    try {
        await clearRecoveryAlarm(tabId);
        await chrome.tabs.reload(tabId);
        await createRecoveryAlarm(tabId, 45000);
    } catch (error) {
        console.error('Failed to refresh tab:', error);
        const recoveredState = normalizeSettings({
            ...nextState,
            pendingRefresh: null
        }, nextState.tabUrl);
        tabStates.set(tabId, recoveredState);
        await scheduleNextRefresh(tabId, recoveredState, { resetAlarm: true });
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const state = tabStates.get(tabId);
    if (!state) {
        return;
    }

    if (tab?.url) {
        state.tabUrl = tab.url;
        tabStates.set(tabId, state);
    }

    if (changeInfo.status !== 'complete') {
        return;
    }

    if (state.pendingRefresh) {
        await clearRecoveryAlarm(tabId);
        await finalizeRefreshCycle(tabId, state);
        return;
    }

    await syncContentScriptState(tabId, state);
    if (state.isActive) {
        startBadgeCountdown(tabId, state);
    }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
    await clearRefreshAlarm(tabId);
    await clearRecoveryAlarm(tabId);
    clearBadgeCountdown(tabId);

    if (tabStates.has(tabId)) {
        tabStates.delete(tabId);
        await saveTabStates();
    }
});

async function finalizeRefreshCycle(tabId, state) {
    const postSnapshot = await captureMonitoringSnapshot(tabId, state);
    const i18n = await getRuntimeI18nContext();
    const evaluation = evaluateMonitoring(state, state.pendingRefresh?.preSnapshot, postSnapshot, i18n);

    const nextState = normalizeSettings({
        ...state,
        pendingRefresh: null,
        contentWatch: {
            ...state.contentWatch,
            lastValue: postSnapshot.numeric?.success && state.contentWatch.enabled && state.contentWatch.selector
                ? postSnapshot.numeric.numericValue
                : state.contentWatch.lastValue
        },
        textWatch: {
            ...state.textWatch,
            previewText: postSnapshot.text?.previewText || state.textWatch.previewText || '',
            lastMatchedKeywords: evaluation.matchedKeywords || []
        },
        schedule: {
            ...state.schedule,
            lastRefreshAt: Date.now()
        }
    }, state.tabUrl);

    tabStates.set(tabId, nextState);
    await saveTabStates();

    try {
        if (evaluation.shouldNotify) {
            const alertSequence = buildAlertSequence(nextState, evaluation);

            await playAlertSequence(alertSequence);
            await createBrowserNotification(evaluation.notificationTitle, evaluation.notificationMessage, {
                tabId,
                selector: evaluation.highlightSelector,
                keywords: evaluation.notificationJumpKeywords || []
            }).catch(() => { });

            if (evaluation.numericTriggered || evaluation.textTriggered) {
                await sendTelegramNotification(nextState.tabUrl, evaluation, nextState, postSnapshot, i18n);
            }

            chrome.runtime.sendMessage({
                type: 'ALERT_TRIGGERED',
                tabId,
                message: evaluation.notificationMessage
            }).catch(() => { });
        }

        if (evaluation.shouldHighlight) {
            await chrome.tabs.sendMessage(tabId, {
                type: 'APPLY_CHANGE_HIGHLIGHT',
                selector: evaluation.highlightSelector,
                mode: evaluation.highlightSelector ? 'element' : 'summary',
                message: evaluation.highlightMessage,
                jumpToSelector: Boolean(evaluation.highlightSelector),
                toastActions: evaluation.toastActions || []
            }).catch(() => { });
        }

        if (nextState.textWatch?.enabled && nextState.textWatch?.debugEnabled && postSnapshot.text?.success) {
            await chrome.tabs.sendMessage(tabId, {
                type: 'SHOW_TEXT_DEBUG',
                sourceMode: nextState.textWatch.sourceMode,
                selector: nextState.textWatch.sourceMode === 'selectorText' ? nextState.textWatch.selector : '',
                previewText: postSnapshot.text.previewText || '',
                debugText: postSnapshot.text.debugText || postSnapshot.text.previewText || '',
                matchedKeywords: evaluation.matchedKeywords || []
            }).catch(() => { });
        }
    } catch (error) {
        console.error('Refresh-cycle post-processing failed:', error);
    } finally {
        await scheduleNextRefresh(tabId, nextState, { resetAlarm: true });
        await syncContentScriptState(tabId, nextState);
    }
}

function buildAlertSequence(state, evaluation) {
    if (state.alertRouting?.mode === 'shared') {
        return [{
            soundType: state.alertRouting.sharedSound || 'siren',
            volume: (state.alertRouting.sharedVolume ?? 80) / 100
        }];
    }

    const sequence = [];

    if (evaluation.numericTriggered) {
        sequence.push({
            soundType: state.contentWatch?.alertSound || 'siren',
            volume: (state.contentWatch?.alertVolume ?? 80) / 100
        });
    }

    if (evaluation.textTriggered) {
        sequence.push({
            soundType: state.textWatch?.alertSound || 'chime',
            volume: (state.textWatch?.alertVolume ?? 80) / 100
        });
    }

    return sequence;
}

function evaluateMonitoring(state, preSnapshot, postSnapshot, i18n) {
    const previousNumericValue = state.contentWatch?.lastValue ?? null;
    const currentNumericValue = postSnapshot.numeric?.success ? postSnapshot.numeric.numericValue : null;
    const numericTriggered = evaluateNumericAlert(state.contentWatch, previousNumericValue, currentNumericValue);
    const preText = preSnapshot?.text?.monitoredText || '';
    const postText = postSnapshot.text?.monitoredText || '';
    const previousMatchedKeywords = normalizeKeywords(state.textWatch?.lastMatchedKeywords || []);
    const matchedKeywords = state.textWatch?.enabled
        ? findMatchedKeywords(postText, state.textWatch.keywords)
        : [];
    const textChanged = Boolean(state.textWatch?.enabled && (preText || postText) && preText !== postText);
    const keywordState = getKeywordState(previousMatchedKeywords, matchedKeywords);
    const textTriggered = evaluateTextAlert(state.textWatch, textChanged, matchedKeywords, keywordState);
    const numericChanged = previousNumericValue !== null && currentNumericValue !== null && previousNumericValue !== currentNumericValue;
    const shouldHighlight = Boolean(textTriggered || numericChanged || numericTriggered);
    const highlightSelector = state.textWatch?.enabled
        && state.textWatch.sourceMode === 'selectorText'
        && postSnapshot.text?.selectorFound
        ? state.textWatch.selector
        : (numericTriggered && state.contentWatch?.selector && postSnapshot.numeric?.selectorFound ? state.contentWatch.selector : '');
    const notificationJumpKeywords = textTriggered && !highlightSelector ? matchedKeywords.slice() : [];
    const toastActions = [];

    let notificationTitle = i18n.t('notification_title', 'Auto Refresh alert');
    let notificationMessage = i18n.t('notification_defaultBody', 'A monitored page changed.');
    let highlightMessage = i18n.t('changeHighlight_default', 'Change detected after refresh.');
    const textFragments = [];

    if (textChanged) {
        textFragments.push(i18n.t('notification_textChanged', 'Text changed.'));
    }

    if (matchedKeywords.length > 0) {
        textFragments.push(`${i18n.t('notification_keywordsFound', 'Keywords found:')} ${matchedKeywords.join(', ')}`);
    }

    if (keywordState.disappeared.length > 0) {
        textFragments.push(`${i18n.t('notification_keywordsGone', 'Keywords disappeared:')} ${keywordState.disappeared.join(', ')}`);
    }

    if (numericTriggered && textTriggered) {
        notificationMessage = `${i18n.t('notification_valueChanged', 'Value changed')}: ${previousNumericValue ?? 'N/A'} -> ${currentNumericValue ?? 'N/A'}. ${textFragments.join(' ')}`.trim();
        highlightMessage = i18n.t('changeHighlight_combined', 'Numeric and text changes detected.');
    } else if (numericTriggered) {
        notificationMessage = `${i18n.t('notification_valueChanged', 'Value changed')}: ${previousNumericValue ?? 'N/A'} -> ${currentNumericValue ?? 'N/A'}`;
        highlightMessage = i18n.t('changeHighlight_numeric', 'Monitored value changed after refresh.');
    } else if (textTriggered) {
        notificationMessage = textFragments.join(' ') || i18n.t('notification_textChanged', 'Text changed.');
        highlightMessage = matchedKeywords.length > 0
            ? i18n.t('changeHighlight_keywords', 'Monitored keywords found after refresh.')
            : i18n.t('changeHighlight_text', 'Monitored text changed after refresh.');
    }

    if (numericTriggered && state.contentWatch?.selector && postSnapshot.numeric?.selectorFound) {
        toastActions.push({
            type: 'selector',
            role: 'numeric',
            selector: state.contentWatch.selector,
            label: i18n.t('toast_actionNumber', 'Go to number')
        });
    }

    if (textTriggered) {
        if (state.textWatch?.sourceMode === 'selectorText' && state.textWatch?.selector && postSnapshot.text?.selectorFound) {
            toastActions.push({
                type: 'selector',
                role: 'text',
                selector: state.textWatch.selector,
                label: i18n.t('toast_actionText', 'Go to text')
            });
        } else if (matchedKeywords.length > 0) {
            toastActions.push({
                type: 'keywords',
                role: 'text',
                keywords: matchedKeywords,
                label: i18n.t('toast_actionText', 'Go to text')
            });
        }
    }

    if (state.textWatch?.debugEnabled && (textTriggered || matchedKeywords.length > 0)) {
        toastActions.push({
            type: 'debug',
            role: 'debug',
            label: i18n.t('toast_actionDebug', 'Open debug')
        });
    }

    return {
        numericTriggered,
        textTriggered,
        textChanged,
        keywordStateChanged: keywordState.changed,
        matchedKeywords,
        textPreview: postSnapshot.text?.previewText || '',
        textDebugText: postSnapshot.text?.debugText || '',
        textSourceMode: state.textWatch?.sourceMode || 'selectorText',
        shouldNotify: Boolean(numericTriggered || textTriggered),
        shouldHighlight,
        highlightSelector,
        highlightMessage,
        notificationTitle,
        notificationMessage,
        notificationJumpKeywords,
        toastActions,
        numericOldValue: previousNumericValue,
        numericNewValue: currentNumericValue
    };
}

function evaluateTextAlert(textWatch, textChanged, matchedKeywords, keywordState) {
    if (!textWatch?.enabled) {
        return false;
    }

    switch (textWatch.detectMode) {
        case 'change':
            return textChanged;
        case 'keywords':
            return keywordState.changed;
        case 'keywordState':
            return keywordState.changed;
        case 'changeOrKeywords':
            return textChanged || keywordState.changed;
        default:
            return false;
    }
}

function getKeywordState(previousMatchedKeywords = [], matchedKeywords = []) {
    const previousSet = new Set(previousMatchedKeywords.map((keyword) => String(keyword).toLowerCase()));
    const currentSet = new Set(matchedKeywords.map((keyword) => String(keyword).toLowerCase()));
    const appeared = matchedKeywords.filter((keyword) => !previousSet.has(String(keyword).toLowerCase()));
    const disappeared = previousMatchedKeywords.filter((keyword) => !currentSet.has(String(keyword).toLowerCase()));

    return {
        appeared,
        disappeared,
        changed: appeared.length > 0 || disappeared.length > 0
    };
}

function evaluateNumericAlert(contentWatch, previousValue, currentValue) {
    if (!contentWatch?.enabled || !contentWatch?.selector) {
        return false;
    }

    if (previousValue === null || currentValue === null) {
        return false;
    }

    const alertMode = contentWatch.alertMode || 'increase';
    const threshold = contentWatch.threshold || 0;

    switch (alertMode) {
        case 'increase':
            return currentValue > previousValue;
        case 'decrease':
            return currentValue < previousValue;
        case 'any':
            return currentValue !== previousValue;
        case 'above':
            return currentValue > threshold;
        case 'below':
            return currentValue < threshold;
        default:
            return false;
    }
}

function findMatchedKeywords(text, keywords = []) {
    const haystack = String(text || '').toLowerCase();
    if (!haystack) {
        return [];
    }

    return keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase()));
}

async function captureMonitoringSnapshot(tabId, state) {
    const numericEnabled = Boolean(state.contentWatch?.enabled && state.contentWatch?.selector);
    const textEnabled = Boolean(state.textWatch?.enabled);
    const textSourceMode = state.textWatch?.sourceMode || 'selectorText';
    const includePageText = textEnabled && textSourceMode === 'pageText';
    const includePageHtml = textEnabled && textSourceMode === 'pageHtml';

    if (!numericEnabled && !textEnabled) {
        return {
            success: false,
            numeric: { success: false, selectorFound: false, numericValue: null, previewText: '' },
            text: { success: false, selectorFound: false, monitoredText: '', previewText: '', debugText: '' }
        };
    }

    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            type: 'CAPTURE_MONITOR_SNAPSHOT',
            numericSelector: state.contentWatch?.selector || '',
            textSelector: state.textWatch?.selector || '',
            textSourceMode,
            includePageText,
            includePageHtml
        });

        return {
            success: Boolean(response?.success),
            numeric: {
                success: Boolean(response?.numeric?.success),
                selectorFound: Boolean(response?.numeric?.selectorFound),
                numericValue: response?.numeric?.numericValue ?? null,
                previewText: response?.numeric?.previewText || ''
            },
            text: {
                success: Boolean(response?.text?.success),
                selectorFound: Boolean(response?.text?.selectorFound),
                monitoredText: response?.text?.monitoredText || '',
                previewText: response?.text?.previewText || '',
                debugText: response?.text?.debugText || ''
            }
        };
    } catch (error) {
        console.log('Snapshot capture failed:', error.message);
        return {
            success: false,
            numeric: { success: false, selectorFound: false, numericValue: null, previewText: '' },
            text: { success: false, selectorFound: false, monitoredText: '', previewText: '', debugText: '' }
        };
    }
}

async function syncContentScriptState(tabId, state) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'SYNC_MONITOR_STATE',
            isActive: Boolean(state.isActive),
            stopOnClickEnabled: Boolean(state.isActive && state.stopOnClick)
        });
    } catch {
        // Content script may not be ready yet.
    }
}

async function showPageSummary(tabId, message) {
    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'SHOW_MONITOR_TOAST',
            message
        });
    } catch {
        // Ignore pages where the content script is not available.
    }
}

function startBadgeCountdown(tabId, state) {
    clearBadgeCountdown(tabId);
    updateBadge(tabId, state);

    if (!state.isActive || !state.schedule?.nextRefreshAt) {
        return;
    }

    const interval = setInterval(() => {
        const currentState = tabStates.get(tabId);
        if (!currentState?.isActive || !currentState.schedule?.nextRefreshAt) {
            clearBadgeCountdown(tabId);
            return;
        }

        updateBadge(tabId, currentState);
    }, 1000);

    badgeIntervals.set(tabId, interval);
}

function clearBadgeCountdown(tabId) {
    if (badgeIntervals.has(tabId)) {
        clearInterval(badgeIntervals.get(tabId));
        badgeIntervals.delete(tabId);
    }
}

function updateBadge(tabId, state) {
    const remainingMs = Math.max(0, (state.schedule?.nextRefreshAt || 0) - Date.now());
    const text = formatBadgeText(remainingMs);

    chrome.action.setBadgeText({ text, tabId }).catch(() => { });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId }).catch(() => { });

    if (!text) {
        clearBadgeCountdown(tabId);
    }
}

function formatBadgeText(remainingMs) {
    if (!remainingMs) {
        return '';
    }

    const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    if (remainingSeconds <= 0) {
        return '';
    }

    if (remainingSeconds >= 60) {
        return `${Math.ceil(remainingSeconds / 60)}m`;
    }

    return `${remainingSeconds}s`;
}

async function saveTabStates() {
    const tabStatesByTabId = {};
    const restorableActiveTimers = [];

    for (const [tabId, state] of tabStates.entries()) {
        tabStatesByTabId[tabId] = state;
        if (state.isActive) {
            restorableActiveTimers.push({
                ...state,
                pendingRefresh: null
            });
        }
    }

    await chrome.storage.local.set({
        [STORAGE_KEYS.tabStatesByTabId]: tabStatesByTabId,
        [STORAGE_KEYS.restorableActiveTimers]: restorableActiveTimers
    });
}

async function checkBlacklist(url) {
    const result = await chrome.storage.sync.get(['urlBlacklist', 'urlWhitelist']);
    const blacklist = result.urlBlacklist || [];
    const whitelist = result.urlWhitelist || [];

    for (const pattern of whitelist) {
        if (matchPattern(url, pattern)) {
            return false;
        }
    }

    for (const pattern of blacklist) {
        if (matchPattern(url, pattern)) {
            return true;
        }
    }

    return false;
}

function matchPattern(url, pattern) {
    if (!url || !pattern) {
        return false;
    }

    pattern = pattern.trim();
    url = url.trim();

    if (!pattern.includes('*')) {
        return url.toLowerCase().includes(pattern.toLowerCase());
    }

    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');

    try {
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(url);
    } catch {
        return url.toLowerCase().includes(pattern.toLowerCase().replace(/\*/g, ''));
    }
}

async function playAlertSound(soundType = 'siren', volume = 0.8, { interrupt = false } = {}) {
    await sendOffscreenPlaybackMessage({
        type: 'PLAY_AUDIO',
        target: 'offscreen',
        soundType,
        volume,
        interrupt
    });
}

async function playAlertSequence(sequence = [], { interrupt = false } = {}) {
    const normalizedSequence = Array.isArray(sequence)
        ? sequence.filter((entry) => entry?.soundType).map((entry) => ({
            soundType: entry.soundType,
            volume: entry.volume ?? 0.8
        }))
        : [];

    if (!normalizedSequence.length) {
        return;
    }

    await sendOffscreenPlaybackMessage({
        type: 'PLAY_AUDIO_SEQUENCE',
        target: 'offscreen',
        sequence: normalizedSequence,
        interrupt
    });
}

async function sendOffscreenPlaybackMessage(message) {
    try {
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            chrome.runtime.sendMessage(message).catch(() => { });
            return;
        }

        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Playing alert sound for content and keyword change detection'
        });

        setTimeout(() => {
            chrome.runtime.sendMessage(message).catch(() => { });
        }, 100);
    } catch (error) {
        console.error('Failed to create offscreen document:', error);
    }
}

function stopAlertSound() {
    chrome.runtime.sendMessage({
        type: 'STOP_AUDIO',
        target: 'offscreen'
    }).catch(() => { });
}

async function createBrowserNotification(title, message, target = null) {
    const notificationId = `${NOTIFICATION_ID_PREFIX}${Date.now()}`;
    if (target?.tabId) {
        notificationTargets.set(notificationId, target);
    }
    await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: NOTIFICATION_ICON_URL,
        title,
        message
    });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
    const target = notificationTargets.get(notificationId);
    if (!target?.tabId) {
        return;
    }

    const tab = await chrome.tabs.get(target.tabId).catch(() => null);
    if (!tab) {
        notificationTargets.delete(notificationId);
        return;
    }

    await chrome.tabs.update(target.tabId, { active: true }).catch(() => { });

    if (target.selector) {
        await chrome.tabs.sendMessage(target.tabId, {
            type: 'JUMP_TO_SELECTOR',
            selector: target.selector
        }).catch(() => { });
    } else if (Array.isArray(target.keywords) && target.keywords.length > 0) {
        await chrome.tabs.sendMessage(target.tabId, {
            type: 'JUMP_TO_KEYWORDS',
            keywords: target.keywords
        }).catch(() => { });
    }

    notificationTargets.delete(notificationId);
    chrome.notifications.clear(notificationId).catch(() => { });
});

chrome.notifications.onClosed.addListener((notificationId) => {
    notificationTargets.delete(notificationId);
});

async function sendTelegramNotification(url, evaluation, state, postSnapshot, i18n = null) {
    try {
        const result = await chrome.storage.sync.get(['telegramSettings']);
        const settings = result.telegramSettings;

        if (!settings?.enabled || !settings?.botToken || !settings?.chatId) {
            return;
        }

        const escapeHtml = (unsafe) => {
            if (!unsafe && unsafe !== 0) {
                return unsafe;
            }

            return String(unsafe)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        };

        const truncate = (str, n) => {
            return (str && str.length > n) ? str.substring(0, n - 1) + '...' : str;
        };

        const safeOld = escapeHtml(truncate(evaluation.numericOldValue, 1000));
        const safeNew = escapeHtml(truncate(evaluation.numericNewValue, 1000));
        const safeUrl = escapeHtml(url);
        const runtimeI18n = i18n || await getRuntimeI18nContext();
        const formattedTime = new Date().toLocaleString(runtimeI18n.locale || 'en');

        const message = `🔔 <b>Alert: Content Changed!</b>

📊 <b>Value:</b> ${safeOld || 'N/A'} → ${safeNew || 'N/A'}
🔗 <b>URL:</b> ${safeUrl || 'Unknown'}
⏰ <b>Time:</b> ${new Date().toLocaleString()}

<i>Auto Refresh & Page Monitor</i>`;
        let localizedMessage = `🔔 <b>${escapeHtml(runtimeI18n.t('telegram_messageTitle', 'Alert: monitored value changed!'))}</b>

📊 <b>${escapeHtml(runtimeI18n.t('telegram_messageValue', 'Value'))}:</b> ${safeOld || 'N/A'} → ${safeNew || 'N/A'}
🔗 <b>${escapeHtml(runtimeI18n.t('telegram_messageUrl', 'URL'))}:</b> ${safeUrl || escapeHtml(runtimeI18n.t('telegram_messageUnknownUrl', 'Unknown'))}
⏰ <b>${escapeHtml(runtimeI18n.t('telegram_messageTime', 'Time'))}:</b> ${escapeHtml(formattedTime)}

<i>${escapeHtml(runtimeI18n.t('appName', 'Auto Refresh & Page Monitor with Telegram Alerts'))}</i>`;

        if (evaluation.textTriggered) {
            const parts = [
                `🔔 <b>${escapeHtml(runtimeI18n.t('telegram_messageTitle', 'Alert: monitored value changed!'))}</b>`
            ];

            if (evaluation.numericTriggered) {
                parts.push(`📊 <b>${escapeHtml(runtimeI18n.t('telegram_messageValue', 'Value'))}:</b> ${safeOld || 'N/A'} → ${safeNew || 'N/A'}`);
            }

            const previewLabel = escapeHtml(runtimeI18n.t('textWatch_debugPreview', 'Preview'));
            const previewValue = evaluation.textPreview
                || postSnapshot?.text?.previewText
                || postSnapshot?.text?.debugText
                || '';
            const previewText = escapeHtml(truncate(previewValue, 500))
                || escapeHtml(runtimeI18n.t('textWatch_debugEmpty', 'No captured content available.'));
            const sourceLabel = escapeHtml(runtimeI18n.t('textWatch_debugSource', 'Source'));
            const sourceValue = escapeHtml(getTextSourceLabel(evaluation.textSourceMode || state?.textWatch?.sourceMode, runtimeI18n));

            parts.push(`📝 <b>${previewLabel}:</b> ${previewText}`);
            parts.push(`📍 <b>${sourceLabel}:</b> ${sourceValue}`);

            if (Array.isArray(evaluation.matchedKeywords) && evaluation.matchedKeywords.length > 0) {
                parts.push(`🏷️ <b>${escapeHtml(runtimeI18n.t('notification_keywordsFound', 'Keywords found:'))}</b> ${escapeHtml(evaluation.matchedKeywords.join(', '))}`);
            }

            parts.push(`🔗 <b>${escapeHtml(runtimeI18n.t('telegram_messageUrl', 'URL'))}:</b> ${safeUrl || escapeHtml(runtimeI18n.t('telegram_messageUnknownUrl', 'Unknown'))}`);
            parts.push(`⏰ <b>${escapeHtml(runtimeI18n.t('telegram_messageTime', 'Time'))}:</b> ${escapeHtml(formattedTime)}`);
            parts.push(`<i>${escapeHtml(runtimeI18n.t('appName', 'Auto Refresh & Page Monitor with Telegram Alerts'))}</i>`);

            localizedMessage = parts.join('\n\n');
        }

        const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.chatId,
                text: localizedMessage,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();

        if (!data.ok) {
            await chrome.storage.local.set({
                telegramLastStatus: {
                    success: false,
                    time: Date.now(),
                    error: data.description || runtimeI18n.t('telegram_statusUnknownError', 'Unknown error')
                }
            });
        } else {
            await chrome.storage.local.set({
                telegramLastStatus: {
                    success: true,
                    time: Date.now(),
                    messageKey: 'telegram_statusSentSuccessfully'
                }
            });
        }
    } catch (error) {
        const runtimeI18n = i18n || await getRuntimeI18nContext();
        await chrome.storage.local.set({
            telegramLastStatus: {
                success: false,
                time: Date.now(),
                error: error.message || runtimeI18n.t('telegram_statusNetworkError', 'Network error')
            }
        });
    }
}

function getTextSourceLabel(sourceMode, i18n) {
    switch (sourceMode) {
        case 'pageText':
            return i18n.t('textWatch_sourcePageText', 'Full page text');
        case 'pageHtml':
            return i18n.t('textWatch_sourcePageHtml', 'Full page HTML');
        case 'selectorText':
        default:
            return i18n.t('textWatch_sourceSelector', 'Selected element text');
    }
}

function normalizeRuntimeLanguage(lang = '') {
    const normalized = String(lang || '').trim().replace('-', '_');
    if (RUNTIME_LANGUAGE_MAP[normalized]) {
        return normalized;
    }

    const base = normalized.split('_')[0];
    if (RUNTIME_LANGUAGE_MAP[base]) {
        return base;
    }

    return 'en';
}

async function getSelectedRuntimeLanguage() {
    const result = await chrome.storage.sync.get(['selectedLanguage']);
    return normalizeRuntimeLanguage(result.selectedLanguage || chrome.i18n.getUILanguage?.() || 'en');
}

async function loadRuntimeTranslations(lang) {
    const normalizedLang = normalizeRuntimeLanguage(lang);
    if (runtimeTranslationCache.has(normalizedLang)) {
        return runtimeTranslationCache.get(normalizedLang);
    }

    const folder = RUNTIME_LANGUAGE_MAP[normalizedLang]?.folder || 'en';

    try {
        const response = await fetch(chrome.runtime.getURL(`i18n/${folder}/messages.json`));
        if (!response.ok) {
            throw new Error(`Failed to load i18n/${folder}/messages.json`);
        }

        const rawMessages = await response.json();
        const flattenedMessages = {};
        for (const [key, value] of Object.entries(rawMessages)) {
            flattenedMessages[key] = value?.message || '';
        }

        runtimeTranslationCache.set(normalizedLang, flattenedMessages);
        return flattenedMessages;
    } catch (error) {
        console.error(`Failed to load runtime translations for ${normalizedLang}:`, error);
        if (normalizedLang !== 'en') {
            return loadRuntimeTranslations('en');
        }

        return {};
    }
}

async function getRuntimeI18nContext() {
    const lang = await getSelectedRuntimeLanguage();
    const messages = await loadRuntimeTranslations(lang);

    return {
        lang,
        locale: RUNTIME_LANGUAGE_MAP[lang]?.locale || 'en',
        t(key, fallback = '') {
            return messages[key] || fallback || key;
        }
    };
}

async function handleSelectorPicked(tabId, tabUrl, watchType, selector, value, previewText) {
    if (!tabId || !tabUrl) {
        console.error('handleSelectorPicked: missing tabId or tabUrl');
        return { success: false, error: 'Missing tab info' };
    }

    const existing = await getTabSettings(tabId);
    const nextState = watchType === 'text'
        ? normalizeSettings({
            ...existing,
            tabUrl,
            textWatch: {
                ...existing.textWatch,
                enabled: true,
                selector,
                sourceMode: 'selectorText',
                previewText: previewText || existing.textWatch?.previewText || ''
            }
        }, tabUrl)
        : normalizeSettings({
            ...existing,
            tabUrl,
            contentWatch: {
                ...existing.contentWatch,
                enabled: true,
                selector,
                lastValue: value
            }
        }, tabUrl);

    tabStates.set(tabId, nextState);
    await saveTabStates();

    chrome.runtime.sendMessage({
        type: 'SELECTOR_UPDATED',
        tabId,
        watchType,
        selector,
        value,
        previewText
    }).catch(() => { });

    return { success: true };
}

console.log('Auto Refresh & Page Monitor service worker started');
