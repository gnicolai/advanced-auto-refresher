/**
 * Advanced Auto Refresher - Content Script
 * Handles element picking and content change detection
 */

// State
let isPickerActive = false;
let pickerOverlay = null;
let highlightedElement = null;
let storedSelector = null;
let storedValue = null;

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'START_PICKER':
            startPicker();
            sendResponse({ success: true });
            break;

        case 'STOP_PICKER':
            stopPicker();
            sendResponse({ success: true });
            break;

        case 'TEST_SELECTOR':
            const result = testSelector(message.selector);
            sendResponse(result);
            break;

        case 'CHECK_CONTENT':
            const checkResult = checkContent(message.selector, message.lastValue);
            sendResponse(checkResult);
            break;

        case 'GET_INITIAL_VALUE':
            const initialResult = getInitialValue(message.selector);
            sendResponse(initialResult);
            break;
    }
    return true;
});

// Start element picker mode
function startPicker() {
    if (isPickerActive) return;
    isPickerActive = true;

    // Create overlay
    createPickerOverlay();

    // Add event listeners
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
}

// Stop element picker mode
function stopPicker() {
    isPickerActive = false;

    // Remove overlay
    removePickerOverlay();

    // Remove highlight
    removeHighlight();

    // Remove event listeners
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
}

// Create picker overlay
function createPickerOverlay() {
    pickerOverlay = document.createElement('div');
    pickerOverlay.id = 'aar-picker-overlay';
    pickerOverlay.innerHTML = `
    <div class="aar-picker-header">
      <span class="aar-picker-icon">🎯</span>
      <span class="aar-picker-title">Seleziona un elemento da monitorare</span>
      <span class="aar-picker-hint">Premi ESC per annullare</span>
    </div>
  `;
    document.body.appendChild(pickerOverlay);
}

// Remove picker overlay
function removePickerOverlay() {
    if (pickerOverlay) {
        pickerOverlay.remove();
        pickerOverlay = null;
    }
}

// Handle mouse over
function handleMouseOver(e) {
    if (!isPickerActive) return;

    // Ignore our own elements
    if (e.target.closest('#aar-picker-overlay') || e.target.closest('.aar-highlight')) {
        return;
    }

    highlightElement(e.target);
}

// Handle mouse out
function handleMouseOut(e) {
    if (!isPickerActive) return;
    removeHighlight();
}

// Highlight element
function highlightElement(element) {
    removeHighlight();

    const rect = element.getBoundingClientRect();

    highlightedElement = document.createElement('div');
    highlightedElement.className = 'aar-highlight';
    highlightedElement.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    pointer-events: none;
    z-index: 2147483646;
  `;

    // Add label with element info
    const label = document.createElement('div');
    label.className = 'aar-highlight-label';

    const textContent = element.textContent.trim().substring(0, 50);
    const numericValue = extractNumbers(textContent);

    label.textContent = numericValue !== null
        ? `Valore: ${numericValue}`
        : `Testo: ${textContent}...`;

    highlightedElement.appendChild(label);
    document.body.appendChild(highlightedElement);

    // Store reference to actual element
    highlightedElement._targetElement = element;
}

// Remove highlight
function removeHighlight() {
    if (highlightedElement) {
        highlightedElement.remove();
        highlightedElement = null;
    }
}

// Handle click
function handleClick(e) {
    if (!isPickerActive) return;

    // Ignore our own elements
    if (e.target.closest('#aar-picker-overlay') || e.target.closest('.aar-highlight')) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Get the target element
    const targetElement = highlightedElement?._targetElement || e.target;

    // Generate CSS selector
    const selector = generateSelector(targetElement);

    // Extract numeric value
    const textContent = targetElement.textContent.trim();
    const numericValue = extractNumbers(textContent);

    // Store for future use
    storedSelector = selector;
    storedValue = numericValue;

    // Send to background
    chrome.runtime.sendMessage({
        type: 'SELECTOR_PICKED',
        tabId: null, // Will be added by background
        selector: selector,
        value: numericValue
    });

    // Stop picker
    stopPicker();

    // Show confirmation
    showConfirmation(selector, numericValue);
}

// Handle key down (ESC to cancel)
function handleKeyDown(e) {
    if (!isPickerActive) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        stopPicker();
    }
}

// Generate a unique CSS selector for an element
function generateSelector(element) {
    // Try ID first
    if (element.id) {
        return `#${CSS.escape(element.id)}`;
    }

    // Try unique class combination
    if (element.classList.length > 0) {
        const classes = Array.from(element.classList)
            .filter(c => !c.startsWith('aar-'))
            .map(c => `.${CSS.escape(c)}`)
            .join('');

        if (classes) {
            const matches = document.querySelectorAll(classes);
            if (matches.length === 1) {
                return classes;
            }
        }
    }

    // Build path from ancestors
    const path = [];
    let current = element;

    while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
            selector = `#${CSS.escape(current.id)}`;
            path.unshift(selector);
            break;
        }

        if (current.classList.length > 0) {
            const classes = Array.from(current.classList)
                .filter(c => !c.startsWith('aar-'))
                .slice(0, 2) // Limit to 2 classes
                .map(c => `.${CSS.escape(c)}`)
                .join('');
            if (classes) {
                selector += classes;
            }
        }

        // Add nth-child if needed
        const parent = current.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                child => child.tagName === current.tagName
            );
            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-child(${index})`;
            }
        }

        path.unshift(selector);
        current = current.parentElement;
    }

    return path.join(' > ');
}

// Extract numbers from text
function extractNumbers(text) {
    // Try to find a number pattern like "di X risultati" or just numbers
    const patterns = [
        /di\s+(\d+)\s+risultat/i,      // Italian: "di 10 risultati"
        /of\s+(\d+)\s+result/i,         // English: "of 10 results"
        /(\d+)\s+(?:prodott|item|articol)/i, // "10 prodotti" or "10 items"
        /totale?:?\s*(\d+)/i,           // "Totale: 10"
        /(\d+)/                          // Just any number
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return parseInt(match[1], 10);
        }
    }

    return null;
}

// Show confirmation toast
function showConfirmation(selector, value) {
    const toast = document.createElement('div');
    toast.className = 'aar-toast';
    toast.innerHTML = `
    <div class="aar-toast-icon">✓</div>
    <div class="aar-toast-content">
      <div class="aar-toast-title">Elemento selezionato!</div>
      <div class="aar-toast-value">Valore iniziale: ${value !== null ? value : 'N/A'}</div>
    </div>
  `;

    document.body.appendChild(toast);

    // Animate in
    setTimeout(() => toast.classList.add('visible'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Test a CSS selector
function testSelector(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            return { success: false, error: 'Element not found' };
        }

        const textContent = element.textContent.trim();
        const numericValue = extractNumbers(textContent);

        return {
            success: true,
            value: textContent.substring(0, 100),
            numericValue: numericValue
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Check content for changes
function checkContent(selector, lastValue) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            return { success: false, error: 'Element not found' };
        }

        const textContent = element.textContent.trim();
        const currentValue = extractNumbers(textContent);

        const changed = currentValue !== lastValue;
        const increased = currentValue > lastValue;

        return {
            success: true,
            changed: changed,
            increased: increased,
            currentValue: currentValue,
            previousValue: lastValue
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Get initial value for a selector
function getInitialValue(selector) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            return { success: false, error: 'Element not found' };
        }

        const textContent = element.textContent.trim();
        const numericValue = extractNumbers(textContent);

        return {
            success: true,
            value: numericValue
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Log for debugging
console.log('Advanced Auto Refresher content script loaded');
