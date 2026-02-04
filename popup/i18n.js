/**
 * Advanced Auto Refresher - Internationalization Module
 * Handles language loading, switching, and translation
 */

// Supported languages with flag emojis
const LANGUAGES = {
    it: { name: 'Italiano', flag: '🇮🇹', dir: 'ltr' },
    en: { name: 'English', flag: '🇬🇧', dir: 'ltr' },
    fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr' },
    de: { name: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
    es: { name: 'Español', flag: '🇪🇸', dir: 'ltr' },
    pt: { name: 'Português', flag: '🇵🇹', dir: 'ltr' },
    pl: { name: 'Polski', flag: '🇵🇱', dir: 'ltr' },
    uk: { name: 'Українська', flag: '🇺🇦', dir: 'ltr' },
    ar: { name: 'العربية', flag: '🇸🇦', dir: 'rtl' }
};

// Current translations
let currentLang = 'it';
let translations = {};

// Initialize i18n
async function initI18n() {
    // Get saved language or detect from browser
    const result = await chrome.storage.sync.get(['selectedLanguage']);
    currentLang = result.selectedLanguage || detectBrowserLanguage();

    // Load translations
    await loadTranslations(currentLang);

    // Apply to DOM
    applyTranslations();

    // Set text direction
    document.documentElement.dir = LANGUAGES[currentLang]?.dir || 'ltr';

    return currentLang;
}

// Detect browser language
function detectBrowserLanguage() {
    const browserLang = navigator.language.split('-')[0];
    return LANGUAGES[browserLang] ? browserLang : 'en';
}

// Load translations for a language
async function loadTranslations(lang) {
    try {
        const response = await fetch(`../locales/${lang}.json`);
        if (!response.ok) throw new Error('Failed to load');
        translations = await response.json();
        currentLang = lang;
    } catch (error) {
        console.error(`Failed to load ${lang}, falling back to English`, error);
        if (lang !== 'en') {
            await loadTranslations('en');
        }
    }
}

// Get translation by key path (e.g., 'timer.title')
function t(keyPath, fallback = '') {
    const keys = keyPath.split('.');
    let value = translations;

    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return fallback || keyPath;
        }
    }

    return value || fallback || keyPath;
}

// Apply translations to all elements with data-i18n attribute
function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);

        if (element.hasAttribute('data-i18n-attr')) {
            const attr = element.getAttribute('data-i18n-attr');
            element.setAttribute(attr, translation);
        } else {
            element.textContent = translation;
        }
    });

    // Handle placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        element.placeholder = t(key);
    });

    // Handle tooltips
    document.querySelectorAll('[data-i18n-tooltip]').forEach(element => {
        const key = element.getAttribute('data-i18n-tooltip');
        element.setAttribute('data-tooltip', t(key));
    });
}

// Change language
async function changeLanguage(lang) {
    if (!LANGUAGES[lang]) return;

    await loadTranslations(lang);

    // Save preference
    await chrome.storage.sync.set({ selectedLanguage: lang });

    // Apply
    applyTranslations();

    // Set text direction (for RTL languages like Arabic)
    document.documentElement.dir = LANGUAGES[lang].dir;

    // Update language selector display
    updateLanguageSelector();

    return lang;
}

// Update language selector button with current flag
function updateLanguageSelector() {
    const btn = document.getElementById('currentLangBtn');
    if (btn) {
        btn.innerHTML = `${LANGUAGES[currentLang].flag} <span class="lang-arrow">▼</span>`;
    }
}

// Create language selector dropdown
function createLanguageSelector(container) {
    const selector = document.createElement('div');
    selector.className = 'language-selector';
    selector.innerHTML = `
        <button id="currentLangBtn" class="lang-btn">
            ${LANGUAGES[currentLang].flag} <span class="lang-arrow">▼</span>
        </button>
        <div class="lang-dropdown" id="langDropdown">
            ${Object.entries(LANGUAGES).map(([code, lang]) => `
                <button class="lang-option ${code === currentLang ? 'active' : ''}" data-lang="${code}">
                    <span class="lang-flag">${lang.flag}</span>
                    <span class="lang-name">${lang.name}</span>
                </button>
            `).join('')}
        </div>
    `;

    container.appendChild(selector);

    // Toggle dropdown
    const btn = selector.querySelector('#currentLangBtn');
    const dropdown = selector.querySelector('#langDropdown');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
    });

    // Handle language selection
    selector.querySelectorAll('.lang-option').forEach(option => {
        option.addEventListener('click', async () => {
            const lang = option.getAttribute('data-lang');
            await changeLanguage(lang);

            // Update active state
            selector.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
            option.classList.add('active');

            // Close dropdown
            dropdown.classList.remove('visible');
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        dropdown.classList.remove('visible');
    });
}

// Export functions
window.i18n = {
    init: initI18n,
    t,
    changeLanguage,
    createLanguageSelector,
    getCurrentLang: () => currentLang,
    getLanguages: () => LANGUAGES
};
