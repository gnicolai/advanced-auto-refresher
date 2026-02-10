/**
 * Advanced Auto Refresher - Background Service Worker
 * Manages timers, alarms, and tab lifecycle
 */

// Storage for active timers
const activeTimers = new Map();

// Audio element for alerts
let alertAudio = null;
let isAlertPlaying = false;

// Initialize
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Advanced Auto Refresher installed');

    // Initialize default settings
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

    // Restore active timers from storage
    await restoreTimers();
});

// Restore timers on startup
chrome.runtime.onStartup.addListener(async () => {
    await restoreTimers();
});

// Restore timers from storage
async function restoreTimers() {
    const result = await chrome.storage.local.get(['activeTimers']);
    const savedTimers = result.activeTimers || {};

    // Find tabs that match saved URLs and restore timers
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
        if (savedTimers[tab.url]) {
            const settings = savedTimers[tab.url];
            if (settings.isActive) {
                startTimer(tab.id, tab.url, settings);
            }
        }
    }
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // Required for async sendResponse
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

        case 'CONTENT_CHANGED':
            return handleContentChange(message.tabId, message.newValue, message.oldValue);

        case 'SELECTOR_PICKED':
            // Use sender.tab for correct tabId and URL
            return handleSelectorPicked(sender.tab?.id, sender.tab?.url, message.selector, message.value);

        default:
            return null;
    }
}

// Get settings for a tab
async function getTabSettings(tabId) {
    // First check in-memory map
    if (activeTimers.has(tabId)) {
        return activeTimers.get(tabId);
    }

    // If not in memory, try to load from storage by getting the tab's URL
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) {
            const result = await chrome.storage.local.get(['activeTimers']);
            const savedTimers = result.activeTimers || {};
            if (savedTimers[tab.url]) {
                // Found saved settings, restore to memory
                const settings = savedTimers[tab.url];
                activeTimers.set(tabId, settings);
                return settings;
            }
        }
    } catch (e) {
        console.log('Could not load tab settings from storage:', e);
    }

    return null;
}

// Toggle refresh on/off
async function toggleRefresh(tabId, tabUrl, settings) {
    if (settings.isActive) {
        await startTimer(tabId, tabUrl, settings);
    } else {
        await stopTimer(tabId);
    }

    // Save to storage for persistence
    await saveTimerState();

    return { success: true };
}

// Update settings without toggle
async function updateSettings(tabId, tabUrl, settings) {
    const existing = activeTimers.get(tabId);
    if (existing) {
        const wasActive = existing.isActive;
        activeTimers.set(tabId, { ...settings, tabUrl });

        // If timer was active, restart with new settings
        if (wasActive && settings.isActive) {
            await chrome.alarms.clear(`refresh_${tabId}`);
            const nextInterval = calculateNextInterval(settings);
            await chrome.alarms.create(`refresh_${tabId}`, { delayInMinutes: nextInterval / 60000 });
            updateBadge(tabId, nextInterval);
        }
    } else {
        activeTimers.set(tabId, { ...settings, tabUrl });
    }

    await saveTimerState();
    return { success: true };
}

// Start timer for a tab
async function startTimer(tabId, tabUrl, settings) {
    const timerSettings = { ...settings, tabUrl, isActive: true };
    activeTimers.set(tabId, timerSettings);

    const nextInterval = calculateNextInterval(settings);

    // Create alarm
    await chrome.alarms.create(`refresh_${tabId}`, { delayInMinutes: nextInterval / 60000 });

    // Save state immediately for persistence
    await saveTimerState();

    // Update badge
    updateBadge(tabId, nextInterval);

    // If content watch enabled, get initial value
    if (settings.contentWatch?.enabled && settings.contentWatch?.selector) {
        try {
            await chrome.tabs.sendMessage(tabId, {
                type: 'GET_INITIAL_VALUE',
                selector: settings.contentWatch.selector
            });
        } catch (e) {
            console.log('Content script not ready yet');
        }
    }

    return { success: true };
}

// Stop timer for a tab
async function stopTimer(tabId) {
    activeTimers.delete(tabId);
    await chrome.alarms.clear(`refresh_${tabId}`);

    // Clear badge
    await chrome.action.setBadgeText({ text: '', tabId });

    return { success: true };
}

// Calculate next refresh interval
function calculateNextInterval(settings) {
    const target = settings.interval * 1000; // Convert to ms
    const minLimit = settings.minLimit * 1000;

    if (!settings.stochastic) {
        return target;
    }

    if (settings.distribution === 'uniform') {
        return calculateUniform(target, minLimit);
    } else {
        return calculateGaussian(target, minLimit);
    }
}

// Uniform distribution: random between min and (2*target - min)
function calculateUniform(target, minLimit) {
    const maxLimit = 2 * target - minLimit;
    const range = maxLimit - minLimit;
    const randomValue = minLimit + Math.random() * range;
    return Math.max(minLimit, Math.round(randomValue));
}

// Gaussian distribution using Box-Muller transform
function calculateGaussian(target, minLimit) {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    // Standard deviation is ~25% of the target
    const sigma = target * 0.25;
    let value = target + z0 * sigma;

    // Ensure minimum limit
    value = Math.max(minLimit, value);

    return Math.round(value);
}

// Alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('refresh_')) return;

    const tabId = parseInt(alarm.name.replace('refresh_', ''));
    let settings = activeTimers.get(tabId);

    // If settings not in memory (service worker was restarted), try to reload from storage
    if (!settings) {
        try {
            const result = await chrome.storage.local.get(['activeTimers', 'activeTimersByTabId']);

            // First, try to find by tabId (most reliable)
            const savedByTabId = result.activeTimersByTabId || {};
            if (savedByTabId[tabId]) {
                settings = savedByTabId[tabId];
                activeTimers.set(tabId, settings);
                console.log('Restored timer from tabId storage for tab:', tabId);
            } else {
                // Fallback: try to find by current tab URL
                const tab = await chrome.tabs.get(tabId);
                if (tab?.url) {
                    const savedByUrl = result.activeTimers || {};
                    if (savedByUrl[tab.url]) {
                        settings = savedByUrl[tab.url];
                        settings.tabUrl = tab.url;
                        activeTimers.set(tabId, settings);
                        console.log('Restored timer from URL storage for tab:', tabId);
                    }
                }
            }
        } catch (e) {
            console.log('Could not restore timer settings:', e.message);
        }
    }

    if (!settings || !settings.isActive) {
        // Timer was stopped, clear the alarm
        await chrome.alarms.clear(alarm.name);
        return;
    }

    // Check blacklist - use CURRENT tab URL, not stored URL
    let currentUrl = settings.tabUrl;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) {
            currentUrl = tab.url;
            // Update stored URL if changed
            if (settings.tabUrl !== tab.url) {
                settings.tabUrl = tab.url;
                activeTimers.set(tabId, settings);
                await saveTimerState();
            }
        }
    } catch (e) {
        console.log('Could not get current tab URL, using stored URL');
    }

    const isBlacklisted = await checkBlacklist(currentUrl);
    if (isBlacklisted) {
        console.log('Tab is blacklisted, skipping refresh:', currentUrl);
        scheduleNextRefresh(tabId, settings);
        return;
    }

    try {
        // If content watch is enabled, check for changes before refresh
        let shouldAlert = false;
        let contentOldValue = null;
        let contentNewValue = null;

        if (settings.contentWatch?.enabled && settings.contentWatch?.selector) {
            try {
                const response = await chrome.tabs.sendMessage(tabId, {
                    type: 'CHECK_CONTENT',
                    selector: settings.contentWatch.selector,
                    lastValue: settings.contentWatch.lastValue
                });

                if (response.success) {
                    const currentValue = response.currentValue;
                    const lastValue = settings.contentWatch.lastValue;
                    const alertMode = settings.contentWatch.alertMode || 'increase';
                    const threshold = settings.contentWatch.threshold || 0;

                    // Save old and new values BEFORE updating lastValue
                    contentOldValue = lastValue;
                    contentNewValue = currentValue;

                    // Determine if alert should trigger based on mode
                    if (lastValue !== null) {
                        switch (alertMode) {
                            case 'increase':
                                shouldAlert = currentValue > lastValue;
                                break;
                            case 'decrease':
                                shouldAlert = currentValue < lastValue;
                                break;
                            case 'any':
                                shouldAlert = currentValue !== lastValue;
                                break;
                            case 'above':
                                shouldAlert = currentValue > threshold;
                                break;
                            case 'below':
                                shouldAlert = currentValue < threshold;
                                break;
                        }
                    }

                    // Always update lastValue to track changes properly
                    settings.contentWatch.lastValue = currentValue;
                    activeTimers.set(tabId, settings);
                    await saveTimerState();
                }
            } catch (e) {
                console.log('Content check failed:', e);
            }
        }

        // Refresh the tab
        await chrome.tabs.reload(tabId);

        // Play alert if content changed
        if (shouldAlert) {
            playAlertSound();
            // Send Telegram notification (using outer-scoped values)
            await sendTelegramNotification(currentUrl, contentOldValue, contentNewValue);
            // Notify popup if open
            chrome.runtime.sendMessage({ type: 'ALERT_TRIGGERED' }).catch(() => { });
        }

    } catch (error) {
        console.error('Failed to refresh tab:', error);

        // CRITICAL: Only stop timer if tab is actually closed
        // Tab might be discarded/suspended, so check if it still exists
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab) {
                // Tab exists but reload failed (maybe discarded/suspended)
                // Don't stop timer, just reschedule
                console.log('Tab exists but reload failed, rescheduling:', tabId);
                scheduleNextRefresh(tabId, settings);
                return;
            }
        } catch (tabError) {
            // Tab truly doesn't exist, stop timer
            console.log('Tab closed, stopping timer:', tabId);
            await stopTimer(tabId);
            await saveTimerState();
            return;
        }
    }

    // Schedule next refresh
    scheduleNextRefresh(tabId, settings);
});

// Schedule next refresh
async function scheduleNextRefresh(tabId, settings) {
    const nextInterval = calculateNextInterval(settings);
    await chrome.alarms.create(`refresh_${tabId}`, { delayInMinutes: nextInterval / 60000 });
    updateBadge(tabId, nextInterval);
}

// Check if URL is blacklisted
async function checkBlacklist(url) {
    const result = await chrome.storage.sync.get(['urlBlacklist', 'urlWhitelist']);
    const blacklist = result.urlBlacklist || [];
    const whitelist = result.urlWhitelist || [];

    // Check whitelist first (whitelist overrides blacklist)
    for (const pattern of whitelist) {
        if (matchPattern(url, pattern)) {
            return false;
        }
    }

    // Check blacklist
    for (const pattern of blacklist) {
        if (matchPattern(url, pattern)) {
            return true;
        }
    }

    return false;
}

// Pattern matching - supports wildcards (*) and substring matching
function matchPattern(url, pattern) {
    if (!url || !pattern) return false;

    // Trim whitespace
    pattern = pattern.trim();
    url = url.trim();

    // If pattern has no wildcards, do simple substring match (case-insensitive)
    if (!pattern.includes('*')) {
        return url.toLowerCase().includes(pattern.toLowerCase());
    }

    // Convert wildcard pattern to regex
    // Escape special regex chars except *
    const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');

    try {
        // Use substring matching (no ^ or $) for more flexible matching
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(url);
    } catch {
        // If regex fails, fall back to simple includes
        return url.toLowerCase().includes(pattern.toLowerCase().replace(/\*/g, ''));
    }
}

// Update badge with countdown
function updateBadge(tabId, intervalMs) {
    const seconds = Math.round(intervalMs / 1000);
    let text = '';

    if (seconds >= 60) {
        text = `${Math.round(seconds / 60)}m`;
    } else {
        text = `${seconds}s`;
    }

    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1', tabId });

    // Start countdown
    startCountdown(tabId, seconds);
}

// Countdown timer for badge
const countdownIntervals = new Map();

function startCountdown(tabId, totalSeconds) {
    // Clear existing countdown
    if (countdownIntervals.has(tabId)) {
        clearInterval(countdownIntervals.get(tabId));
    }

    let remaining = totalSeconds;

    const interval = setInterval(async () => {
        remaining--;

        if (remaining <= 0) {
            clearInterval(interval);
            countdownIntervals.delete(tabId);
            return;
        }

        let text = '';
        if (remaining >= 60) {
            text = `${Math.round(remaining / 60)}m`;
        } else {
            text = `${remaining}s`;
        }

        try {
            await chrome.action.setBadgeText({ text, tabId });
        } catch {
            // Tab might be closed
            clearInterval(interval);
            countdownIntervals.delete(tabId);
        }
    }, 1000);

    countdownIntervals.set(tabId, interval);
}

// Play alert sound
function playAlertSound() {
    if (isAlertPlaying) return;

    isAlertPlaying = true;

    // Create audio context and play siren sound
    const audioUrl = chrome.runtime.getURL('assets/alert.mp3');

    // Use offscreen document for audio in MV3
    createOffscreenDocument(audioUrl);
}

// Create offscreen document for audio playback
async function createOffscreenDocument(audioUrl) {
    try {
        // Check if already exists
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            // Send play message
            chrome.runtime.sendMessage({
                type: 'PLAY_AUDIO',
                target: 'offscreen',
                audioUrl
            });
            return;
        }

        // Create offscreen document
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Playing alert sound for content change detection'
        });

        // Send play message after creation
        setTimeout(() => {
            chrome.runtime.sendMessage({
                type: 'PLAY_AUDIO',
                target: 'offscreen',
                audioUrl
            });
        }, 100);

    } catch (error) {
        console.error('Failed to create offscreen document:', error);
        isAlertPlaying = false;
    }
}

// Stop alert sound
function stopAlertSound() {
    isAlertPlaying = false;
    chrome.runtime.sendMessage({
        type: 'STOP_AUDIO',
        target: 'offscreen'
    }).catch(() => { });
}

// Send Telegram notification
async function sendTelegramNotification(url, oldValue, newValue) {
    try {
        // Get Telegram settings
        const result = await chrome.storage.sync.get(['telegramSettings']);
        const settings = result.telegramSettings;

        // Check if Telegram is enabled and configured
        if (!settings?.enabled || !settings?.botToken || !settings?.chatId) {
            return;
        }

        // Helper to escape HTML characters for Telegram
        const escapeHtml = (unsafe) => {
            if (!unsafe) return unsafe;
            return String(unsafe)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        };

        // Helper to truncate long text
        const truncate = (str, n) => {
            return (str && str.length > n) ? str.substr(0, n - 1) + '...' : str;
        };

        const safeOld = escapeHtml(truncate(oldValue, 1000));
        const safeNew = escapeHtml(truncate(newValue, 1000));
        const safeUrl = escapeHtml(url);

        // Build message (using HTML for safety against special chars in values)
        const message = `🔔 <b>Alert: Content Changed!</b>

📊 <b>Value:</b> ${safeOld || 'N/A'} → ${safeNew || 'N/A'}
🔗 <b>URL:</b> ${safeUrl || 'Unknown'}
⏰ <b>Time:</b> ${new Date().toLocaleString()}

<i>Advanced Auto Refresher</i>`;

        // Send to Telegram
        const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.chatId,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();

        if (!data.ok) {
            console.log('Telegram notification failed:', data.description);
            await chrome.storage.local.set({
                telegramLastStatus: {
                    success: false,
                    time: Date.now(),
                    error: data.description || 'Unknown API Error'
                }
            });
        } else {
            console.log('Telegram notification sent successfully');
            await chrome.storage.local.set({
                telegramLastStatus: {
                    success: true,
                    time: Date.now(),
                    message: 'Last notification sent successfully'
                }
            });
        }
    } catch (error) {
        console.log('Telegram notification error:', error.message);
        await chrome.storage.local.set({
            telegramLastStatus: {
                success: false,
                time: Date.now(),
                error: error.message || 'Network/Script Error'
            }
        });
    }
}

// Handle selector picked from content script
async function handleSelectorPicked(tabId, tabUrl, selector, value) {
    if (!tabId || !tabUrl) {
        console.error('handleSelectorPicked: missing tabId or tabUrl');
        return { success: false, error: 'Missing tab info' };
    }

    // Get existing settings or create new ones
    let settings = activeTimers.get(tabId) || {
        isActive: false,
        interval: 30,
        stochastic: false,
        minLimit: 5,
        distribution: 'uniform',
        tabUrl: tabUrl
    };

    // Ensure tabUrl is set
    settings.tabUrl = tabUrl;

    // Initialize or update contentWatch
    if (!settings.contentWatch) {
        settings.contentWatch = { enabled: true, selector: '', lastValue: null };
    }

    settings.contentWatch.selector = selector;
    settings.contentWatch.lastValue = value;
    settings.contentWatch.enabled = true;

    // Save to activeTimers
    activeTimers.set(tabId, settings);

    // Also save directly to storage for persistence
    await saveTimerState();

    // Additionally save to storage by URL for when popup reopens
    const result = await chrome.storage.local.get(['activeTimers']);
    const savedTimers = result.activeTimers || {};
    savedTimers[tabUrl] = settings;
    await chrome.storage.local.set({ activeTimers: savedTimers });

    console.log('Selector saved:', { tabId, tabUrl, selector, value });

    // Notify popup (may fail if popup is closed, that's OK)
    chrome.runtime.sendMessage({
        type: 'SELECTOR_UPDATED',
        selector,
        value
    }).catch(() => { });

    return { success: true };
}

// Handle content change
async function handleContentChange(tabId, newValue, oldValue) {
    if (newValue > oldValue) {
        playAlertSound();
        chrome.runtime.sendMessage({
            type: 'ALERT_TRIGGERED',
            newValue,
            oldValue
        }).catch(() => { });
    }

    // Update stored value
    const settings = activeTimers.get(tabId);
    if (settings?.contentWatch) {
        settings.contentWatch.lastValue = newValue;
        activeTimers.set(tabId, settings);
        await saveTimerState();
    }

    return { success: true };
}

// Save timer state to storage (save by both tabId and URL for robust recovery)
async function saveTimerState() {
    const timerDataByUrl = {};
    const timerDataByTabId = {};

    for (const [tabId, settings] of activeTimers) {
        // Save by tabId for reliable recovery
        timerDataByTabId[tabId] = { ...settings, tabId };

        // Also save by URL for URL-based matching
        if (settings.tabUrl) {
            timerDataByUrl[settings.tabUrl] = { ...settings, tabId };
        }
    }

    await chrome.storage.local.set({
        activeTimers: timerDataByUrl,
        activeTimersByTabId: timerDataByTabId
    });
}

// Tab removed handler
chrome.tabs.onRemoved.addListener(async (tabId) => {
    // Keep settings in storage for potential restore, just stop the timer
    if (activeTimers.has(tabId)) {
        await chrome.alarms.clear(`refresh_${tabId}`);

        if (countdownIntervals.has(tabId)) {
            clearInterval(countdownIntervals.get(tabId));
            countdownIntervals.delete(tabId);
        }

        activeTimers.delete(tabId);
    }
});

// Tab updated handler - restore timer if URL matches
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const result = await chrome.storage.local.get(['activeTimers']);
        const savedTimers = result.activeTimers || {};

        if (savedTimers[tab.url] && savedTimers[tab.url].isActive) {
            // Restore timer for this URL
            const settings = savedTimers[tab.url];

            // Check if timer already running for this tab
            if (!activeTimers.has(tabId)) {
                await startTimer(tabId, tab.url, settings);
            }

            // Re-inject content script value check if content watch enabled
            if (settings.contentWatch?.enabled && settings.contentWatch?.selector) {
                setTimeout(async () => {
                    try {
                        await chrome.tabs.sendMessage(tabId, {
                            type: 'CHECK_CONTENT',
                            selector: settings.contentWatch.selector,
                            lastValue: settings.contentWatch.lastValue
                        });
                    } catch (e) {
                        // Content script not ready
                    }
                }, 1000);
            }
        }
    }
});

console.log('Advanced Auto Refresher service worker started');
