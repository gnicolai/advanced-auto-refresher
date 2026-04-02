/**
 * Auto Refresh & Page Monitor with Telegram Alerts - Content Script
 * Handles picker UX, snapshots, in-page highlighting, and optional click-stop.
 */

let isPickerActive = false;
let pickerWatchType = 'numeric';
let pickerOverlay = null;
let highlightedOverlay = null;
let stopOnClickEnabled = false;
let clickPauseSent = false;
let lastTextDebugPayload = null;

document.addEventListener('click', handleMonitoredPageClick, true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_PICKER':
            startPicker(message.watchType || 'numeric');
            sendResponse({ success: true });
            break;

        case 'STOP_PICKER':
            stopPicker();
            sendResponse({ success: true });
            break;

        case 'TEST_SELECTOR':
            sendResponse(testSelector(message.selector));
            break;

        case 'CAPTURE_MONITOR_SNAPSHOT':
            sendResponse(captureMonitorSnapshot(message));
            break;

        case 'APPLY_CHANGE_HIGHLIGHT':
            applyChangeHighlight(message.selector, message.mode, message.message, message.jumpToSelector, message.toastActions || []);
            sendResponse({ success: true });
            break;

        case 'SHOW_MONITOR_TOAST':
            showMonitorToast(message.message, {
                tone: message.tone || 'info',
                jumpSelector: message.jumpSelector || ''
            });
            sendResponse({ success: true });
            break;

        case 'SHOW_TEXT_DEBUG':
            showTextDebugPanel(message);
            sendResponse({ success: true });
            break;

        case 'JUMP_TO_SELECTOR':
            sendResponse({ success: jumpToSelector(message.selector) });
            break;

        case 'JUMP_TO_KEYWORDS':
            sendResponse({ success: jumpToKeywords(message.keywords || []) });
            break;

        case 'SYNC_MONITOR_STATE':
            stopOnClickEnabled = Boolean(message.stopOnClickEnabled);
            if (!stopOnClickEnabled) {
                clickPauseSent = false;
            }
            sendResponse({ success: true });
            break;

        default:
            break;
    }

    return true;
});

function startPicker(watchType) {
    if (isPickerActive) {
        return;
    }

    pickerWatchType = watchType || 'numeric';
    isPickerActive = true;
    createPickerOverlay();
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handlePickerClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

function stopPicker() {
    isPickerActive = false;
    removePickerOverlay();
    removeHighlight();
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handlePickerClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
}

function createPickerOverlay() {
    pickerOverlay = document.createElement('div');
    pickerOverlay.id = 'aar-picker-overlay';
    pickerOverlay.innerHTML = `
        <div class="aar-picker-header">
            <span class="aar-picker-icon">*</span>
            <span class="aar-picker-title">${chrome.i18n.getMessage('picker_title') || 'Select an element to monitor'}</span>
            <span class="aar-picker-hint">${chrome.i18n.getMessage('picker_hint') || 'Press ESC to cancel'}</span>
        </div>
    `;
    document.body.appendChild(pickerOverlay);
}

function removePickerOverlay() {
    if (pickerOverlay) {
        pickerOverlay.remove();
        pickerOverlay = null;
    }
}

function handleMouseOver(event) {
    if (!isPickerActive || isExtensionUiElement(event.target)) {
        return;
    }
    highlightElement(event.target);
}

function handleMouseOut() {
    if (!isPickerActive) {
        return;
    }
    removeHighlight();
}

function highlightElement(element) {
    removeHighlight();

    const rect = element.getBoundingClientRect();
    highlightedOverlay = document.createElement('div');
    highlightedOverlay.className = 'aar-highlight';
    highlightedOverlay.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        z-index: 2147483646;
    `;

    const label = document.createElement('div');
    label.className = 'aar-highlight-label';
    const textContent = normalizeText(element.innerText || element.textContent);
    const numericCandidates = extractNumberCandidates(textContent);
    const numericValue = getSelectedNumericValue(numericCandidates);
    label.textContent = pickerWatchType === 'numeric' && numericValue !== null
        ? `Value: ${numericValue}`
        : `Text: ${truncatePreview(textContent, 60) || 'N/A'}`;

    highlightedOverlay.appendChild(label);
    highlightedOverlay._targetElement = element;
    document.body.appendChild(highlightedOverlay);
}

function removeHighlight() {
    if (highlightedOverlay) {
        highlightedOverlay.remove();
        highlightedOverlay = null;
    }
}

function handlePickerClick(event) {
    if (!isPickerActive || isExtensionUiElement(event.target)) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const targetElement = highlightedOverlay?._targetElement || event.target;
    const selector = generateSelector(targetElement);
    const textContent = normalizeText(targetElement.innerText || targetElement.textContent);
    const numericCandidates = extractNumberCandidates(textContent);
    const selectedCandidateIndex = getDefaultCandidateIndex(numericCandidates);
    const numericValue = getSelectedNumericValue(numericCandidates, selectedCandidateIndex);

    chrome.runtime.sendMessage({
        type: 'SELECTOR_PICKED',
        watchType: pickerWatchType,
        selector,
        value: numericValue,
        candidateIndex: selectedCandidateIndex,
        candidates: numericCandidates,
        previewText: truncatePreview(textContent, 120)
    });

    stopPicker();
    showMonitorToast(chrome.i18n.getMessage('picker_selected') || 'Element selected.', {
        tone: 'success',
        jumpSelector: selector
    });
}

function handleKeyDown(event) {
    if (!isPickerActive) {
        return;
    }

    if (event.key === 'Escape') {
        event.preventDefault();
        stopPicker();
    }
}

function handleMonitoredPageClick(event) {
    if (!stopOnClickEnabled || clickPauseSent || isPickerActive) {
        return;
    }

    if (!event.isTrusted || isExtensionUiElement(event.target)) {
        return;
    }

    clickPauseSent = true;
    chrome.runtime.sendMessage({ type: 'USER_PAGE_CLICK' }).catch(() => {
        clickPauseSent = false;
    });
}

function generateSelector(element) {
    if (element.id) {
        return `#${CSS.escape(element.id)}`;
    }

    if (element.classList.length > 0) {
        const classes = Array.from(element.classList)
            .filter((className) => !className.startsWith('aar-'))
            .map((className) => `.${CSS.escape(className)}`)
            .join('');

        if (classes) {
            const matches = document.querySelectorAll(classes);
            if (matches.length === 1) {
                return classes;
            }
        }
    }

    const path = [];
    let current = element;

    while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
            path.unshift(`#${CSS.escape(current.id)}`);
            break;
        }

        if (current.classList.length > 0) {
            const classes = Array.from(current.classList)
                .filter((className) => !className.startsWith('aar-'))
                .slice(0, 2)
                .map((className) => `.${CSS.escape(className)}`)
                .join('');
            if (classes) {
                selector += classes;
            }
        }

        const parent = current.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            if (siblings.length > 1) {
                selector += `:nth-child(${siblings.indexOf(current) + 1})`;
            }
        }

        path.unshift(selector);
        current = current.parentElement;
    }

    return path.join(' > ');
}

function testSelector(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            return { success: false, error: 'Element not found' };
        }

        const textContent = normalizeText(element.innerText || element.textContent);
        const numericCandidates = extractNumberCandidates(textContent);
        const selectedCandidateIndex = getDefaultCandidateIndex(numericCandidates);
        return {
            success: true,
            value: truncatePreview(textContent, 120),
            numericValue: getSelectedNumericValue(numericCandidates, selectedCandidateIndex),
            numericCandidates,
            selectedCandidateIndex
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function captureMonitorSnapshot(message) {
    const numeric = captureNumericSnapshot(message.numericSelector || '', message.numericCandidateIndex);
    const text = captureTextSnapshot(
        message.textSelector || '',
        message.textSourceMode || 'selectorText',
        Boolean(message.includePageText),
        Boolean(message.includePageHtml)
    );

    return {
        success: Boolean(numeric.success || text.success),
        numeric,
        text
    };
}

function captureNumericSnapshot(selector, preferredIndex) {
    if (!selector) {
        return { success: false, selectorFound: false, numericValue: null, previewText: '', numericCandidates: [], selectedCandidateIndex: 0 };
    }

    try {
        const element = document.querySelector(selector);
        if (!element) {
            return { success: false, selectorFound: false, numericValue: null, previewText: '', numericCandidates: [], selectedCandidateIndex: 0 };
        }

        const selectorText = normalizeText(element.innerText || element.textContent);
        const numericCandidates = extractNumberCandidates(selectorText);
        const selectedCandidateIndex = sanitizeCandidateIndex(preferredIndex, numericCandidates.length);
        return {
            success: true,
            selectorFound: true,
            numericValue: getSelectedNumericValue(numericCandidates, selectedCandidateIndex),
            numericCandidates,
            selectedCandidateIndex,
            previewText: truncatePreview(selectorText, 120)
        };
    } catch (error) {
        return { success: false, selectorFound: false, numericValue: null, previewText: '', numericCandidates: [], selectedCandidateIndex: 0, error: error.message };
    }
}

function captureTextSnapshot(selector, sourceMode, includePageText, includePageHtml) {
    try {
        const element = selector ? document.querySelector(selector) : null;
        const selectorFound = Boolean(element);
        const selectorText = selectorFound ? normalizeText(element.innerText || element.textContent) : '';
        const pageText = includePageText ? getPageText() : '';
        const pageHtml = includePageHtml ? getPageHtml() : '';

        let monitoredText = '';
        let previewText = '';
        let debugText = '';

        if (sourceMode === 'pageHtml') {
            monitoredText = pageHtml;
            previewText = truncatePreview(normalizeText(pageHtml), 120);
            debugText = truncateRaw(pageHtml, 1800);
        } else if (sourceMode === 'pageText') {
            monitoredText = pageText;
            previewText = truncatePreview(pageText, 120);
            debugText = truncatePreview(pageText, 1800);
        } else {
            monitoredText = selectorText;
            previewText = truncatePreview(selectorText, 120);
            debugText = truncatePreview(selectorText, 1800);
        }

        if (!monitoredText) {
            return {
                success: false,
                selectorFound,
                monitoredText: '',
                previewText: '',
                debugText: ''
            };
        }

        return {
            success: true,
            selectorFound,
            monitoredText,
            previewText,
            debugText
        };
    } catch (error) {
        return {
            success: false,
            selectorFound: false,
            monitoredText: '',
            previewText: '',
            debugText: '',
            error: error.message
        };
    }
}

function applyChangeHighlight(selector, mode, message, jumpToSelector, toastActions = []) {
    if (mode === 'element' && selector) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.add('aar-change-highlight');
            window.setTimeout(() => {
                element.classList.remove('aar-change-highlight');
            }, 5000);

            showMonitorToast(message || (chrome.i18n.getMessage('changeHighlight_default') || 'Change detected after refresh.'), {
                tone: 'info',
                jumpSelector: jumpToSelector ? selector : '',
                actions: toastActions
            });
            return;
        }
    }

    showMonitorToast(message || (chrome.i18n.getMessage('changeHighlight_default') || 'Change detected after refresh.'), {
        tone: 'info',
        actions: toastActions
    });
}

function showMonitorToast(message, options = {}) {
    if (!message) {
        return;
    }

    const tone = options.tone || 'info';
    const jumpSelector = options.jumpSelector || '';
    const actions = Array.isArray(options.actions) ? options.actions : [];
    const existingToast = document.getElementById('aar-monitor-toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'aar-monitor-toast';
    toast.className = `aar-monitor-toast aar-monitor-toast-${tone}${jumpSelector ? ' aar-monitor-toast-clickable' : ''}`;
    toast.innerHTML = `
        <div class="aar-monitor-toast-title">${chrome.i18n.getMessage('notification_title') || 'Auto Refresh alert'}</div>
        <div class="aar-monitor-toast-message">${message}</div>
        ${actions.length > 0 ? `<div class="aar-monitor-toast-actions"></div>` : ''}
        ${jumpSelector ? `<div class="aar-monitor-toast-hint">${chrome.i18n.getMessage('textWatch_jumpHint') || 'Click to jump to the element.'}</div>` : ''}
    `;

    if (actions.length > 0) {
        const actionsContainer = toast.querySelector('.aar-monitor-toast-actions');
        actions.forEach((action, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'aar-monitor-toast-action';
            button.textContent = action.label || `Action ${index + 1}`;
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                performToastAction(action);
            });
            actionsContainer.appendChild(button);
        });
    }

    if (jumpSelector) {
        toast.addEventListener('click', () => {
            jumpToSelector(jumpSelector);
        });
    }

    document.body.appendChild(toast);
    window.setTimeout(() => toast.classList.add('visible'), 10);
    window.setTimeout(() => {
        toast.classList.remove('visible');
        window.setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function showTextDebugPanel(options = {}) {
    lastTextDebugPayload = { ...options };
    const {
        sourceMode = 'selectorText',
        selector = '',
        previewText = '',
        debugText = '',
        matchedKeywords = []
    } = options;

    const existing = document.getElementById('aar-text-debug-panel');
    if (existing) {
        existing.remove();
    }

    if (sourceMode === 'selectorText' && selector) {
        const element = document.querySelector(selector);
        if (element) {
            element.classList.add('aar-change-highlight');
            window.setTimeout(() => {
                element.classList.remove('aar-change-highlight');
            }, 5000);
        }
    }

    const panel = document.createElement('div');
    panel.id = 'aar-text-debug-panel';
    const keywordsLine = matchedKeywords.length > 0 ? matchedKeywords.join(', ') : '-';
    panel.innerHTML = `
        <div class="aar-debug-header">
            <div class="aar-debug-title">${chrome.i18n.getMessage('textWatch_debugTitle') || 'Text monitor debug'}</div>
            <button type="button" class="aar-debug-close">${chrome.i18n.getMessage('textWatch_debugClose') || 'Close'}</button>
        </div>
        <div class="aar-debug-row"><strong>${chrome.i18n.getMessage('textWatch_debugSource') || 'Source'}:</strong> ${sourceMode}</div>
        ${selector ? `<div class="aar-debug-row"><strong>${chrome.i18n.getMessage('textWatch_debugSelector') || 'Selector'}:</strong> ${escapeHtml(selector)}</div>` : ''}
        <div class="aar-debug-row"><strong>${chrome.i18n.getMessage('textWatch_debugMatches') || 'Matched keywords'}:</strong> ${escapeHtml(keywordsLine)}</div>
        <div class="aar-debug-row"><strong>${chrome.i18n.getMessage('textWatch_debugPreview') || 'Preview'}:</strong> ${escapeHtml(previewText || '-')}</div>
        <div class="aar-debug-block">${escapeHtml(debugText || previewText || (chrome.i18n.getMessage('textWatch_debugEmpty') || 'No captured content available.'))}</div>
    `;

    panel.querySelector('.aar-debug-close')?.addEventListener('click', () => {
        panel.remove();
    });

    document.body.appendChild(panel);
    window.setTimeout(() => panel.classList.add('visible'), 10);
}

function performToastAction(action) {
    if (!action || typeof action !== 'object') {
        return;
    }

    if (action.type === 'selector') {
        jumpToSelector(action.selector);
        return;
    }

    if (action.type === 'keywords') {
        const jumped = jumpToKeywords(action.keywords || []);
        if (!jumped && lastTextDebugPayload) {
            showTextDebugPanel(lastTextDebugPayload);
        }
        return;
    }

    if (action.type === 'debug' && lastTextDebugPayload) {
        showTextDebugPanel(lastTextDebugPayload);
    }
}

function jumpToKeywords(keywords = []) {
    const lowered = keywords
        .map((keyword) => String(keyword || '').trim().toLowerCase())
        .filter(Boolean);

    if (lowered.length === 0) {
        return false;
    }

    const selector = 'a, button, h1, h2, h3, h4, h5, h6, p, span, div, li';
    const candidates = Array.from(document.querySelectorAll(selector))
        .map((element) => {
            const text = normalizeText(element.innerText || element.textContent);
            if (!text || text.length > 280) {
                return null;
            }

            const match = lowered.find((keyword) => text.toLowerCase().includes(keyword));
            if (!match) {
                return null;
            }

            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return null;
            }

            return {
                element,
                match,
                score: text.length
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.score - right.score);

    const target = candidates[0]?.element;
    if (!target) {
        return false;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    target.classList.add('aar-change-highlight');
    window.setTimeout(() => {
        target.classList.remove('aar-change-highlight');
    }, 5000);
    return true;
}

function jumpToSelector(selector) {
    if (!selector) {
        return false;
    }

    const element = document.querySelector(selector);
    if (!element) {
        return false;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    element.classList.add('aar-change-highlight');
    window.setTimeout(() => {
        element.classList.remove('aar-change-highlight');
    }, 5000);
    return true;
}

function getPageText() {
    const source = document.body?.innerText || document.body?.textContent || '';
    return normalizeText(source).slice(0, 50000);
}

function getPageHtml() {
    return String(document.documentElement?.outerHTML || '').slice(0, 500000);
}

function truncatePreview(text, size) {
    const normalized = normalizeText(text);
    if (normalized.length <= size) {
        return normalized;
    }
    return `${normalized.slice(0, size - 1)}...`;
}

function truncateRaw(text, size) {
    const value = String(text || '').trim();
    if (value.length <= size) {
        return value;
    }
    return `${value.slice(0, size - 1)}...`;
}

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isExtensionUiElement(target) {
    if (!(target instanceof Element)) {
        return false;
    }

    return Boolean(
        target.closest('#aar-picker-overlay') ||
        target.closest('.aar-highlight') ||
        target.closest('#aar-monitor-toast')
    );
}

function extractNumberCandidates(text) {
    const source = String(text || '');
    if (!source) {
        return [];
    }

    const matches = source.match(/\d[\d\s.,]*\s*[kKmMbBtT]?/g) || [];
    const values = matches
        .map((match) => parseNumericCandidate(match))
        .filter((value) => Number.isFinite(value));

    return values;
}

function parseNumericCandidate(token) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
        return null;
    }

    const suffixMatch = rawToken.match(/([kKmMbBtT])$/);
    const suffix = suffixMatch ? suffixMatch[1].toLowerCase() : '';
    const multiplier = {
        k: 1_000,
        m: 1_000_000,
        b: 1_000_000_000,
        t: 1_000_000_000_000
    }[suffix] || 1;

    let normalized = suffix ? rawToken.slice(0, -1) : rawToken;
    normalized = normalized.replace(/\s+/g, '');

    if (suffix) {
        const lastComma = normalized.lastIndexOf(',');
        const lastDot = normalized.lastIndexOf('.');
        const decimalIndex = Math.max(lastComma, lastDot);
        if (decimalIndex >= 0) {
            const integerPart = normalized.slice(0, decimalIndex).replace(/[^\d]/g, '');
            const decimalPart = normalized.slice(decimalIndex + 1).replace(/[^\d]/g, '');
            normalized = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
        } else {
            normalized = normalized.replace(/[^\d]/g, '');
        }
    } else {
        normalized = normalized.replace(/[^\d]/g, '');
    }

    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return multiplier === 1 ? parsed : parsed * multiplier;
}

function getDefaultCandidateIndex(candidates = []) {
    return sanitizeCandidateIndex(null, candidates.length);
}

function sanitizeCandidateIndex(candidateIndex, candidateCount) {
    if (!candidateCount) {
        return 0;
    }

    const parsed = parseInt(candidateIndex, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return candidateCount - 1;
    }

    return Math.min(parsed, candidateCount - 1);
}

function getSelectedNumericValue(candidates = [], candidateIndex = null) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const safeIndex = sanitizeCandidateIndex(candidateIndex, candidates.length);
    const value = Number(candidates[safeIndex]);
    return Number.isFinite(value) ? value : null;
}

console.log('Auto Refresh & Page Monitor content script loaded');
