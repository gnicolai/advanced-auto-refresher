/**
 * Advanced Auto Refresher - Internationalization Module
 * Hybrid approach: uses Chrome _locales/*/messages.json format
    * but supports runtime language switching via fetch
        */

// Supported languages with flag emojis
const LANGUAGES = {
    it: { name: 'Italiano', flag: '🇮🇹', dir: 'ltr', chrome: 'it' },
    en: { name: 'English', flag: '🇬🇧', dir: 'ltr', chrome: 'en' },
    fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr', chrome: 'fr' },
    de: { name: 'Deutsch', flag: '🇩🇪', dir: 'ltr', chrome: 'de' },
    es: { name: 'Español', flag: '🇪🇸', dir: 'ltr', chrome: 'es' },
    pt: { name: 'Português', flag: '🇵🇹', dir: 'ltr', chrome: 'pt_BR' },
    pl: { name: 'Polski', flag: '🇵🇱', dir: 'ltr', chrome: 'pl' },
    uk: { name: 'Українська', flag: '🇺🇦', dir: 'ltr', chrome: 'uk' },
    ar: { name: 'العربية', flag: '🇸🇦', dir: 'rtl', chrome: 'ar' }
};

let currentLang = 'it';
let translations = {};

async function initI18n() {
    const result = await chrome.storage.sync.get(['selectedLanguage']);
    currentLang = result.selectedLanguage || detectBrowserLanguage();
    await loadTranslations(currentLang);
    applyTranslations();
    document.documentElement.dir = LANGUAGES[currentLang]?.dir || 'ltr';
    return currentLang;
}

function detectBrowserLanguage() {
    const browserLang = navigator.language.split('-')[0];
    return LANGUAGES[browserLang] ? browserLang : 'en';
}

async function loadTranslations(lang) {
    const chromeCode = LANGUAGES[lang]?.chrome || lang;
    try {
        const response = await fetch(`../_locales/${chromeCode}/messages.json`);
        if (!response.ok) throw new Error('Failed to load');
        const messages = await response.json();
        translations = {};
        for (const [key, val] of Object.entries(messages)) {
            translations[key] = val.message;
        }
        currentLang = lang;
    } catch (error) {
        console.error(`Failed to load ${lang}, falling back to English`, error);
        if (lang !== 'en') {
            await loadTranslations('en');
        }
    }
}

// Get translation by key path (e.g., 'status.active' → 'status_active')
function t(keyPath, fallback = '') {
    const flatKey = keyPath.replace(/\./g, '_');
    return translations[flatKey] || fallback || keyPath;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);
        if (element.hasAttribute('data-i18n-attr')) {
            element.setAttribute(element.getAttribute('data-i18n-attr'), translation);
        } else if (element.tagName === 'LI' && translation.includes('<')) {
            element.innerHTML = translation;
        } else {
            element.textContent = translation;
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        element.placeholder = t(element.getAttribute('data-i18n-placeholder'));
    });

    document.querySelectorAll('[data-i18n-tooltip]').forEach(element => {
        element.setAttribute('data-tooltip', t(element.getAttribute('data-i18n-tooltip')));
    });
}

async function changeLanguage(lang) {
    if (!LANGUAGES[lang]) return;
    await loadTranslations(lang);
    await chrome.storage.sync.set({ selectedLanguage: lang });
    applyTranslations();
    document.documentElement.dir = LANGUAGES[lang].dir;
    updateLanguageSelector();
    return lang;
}

function updateLanguageSelector() {
    const btn = document.getElementById('currentLangBtn');
    if (btn) {
        btn.innerHTML = `${LANGUAGES[currentLang].flag} <span class="lang-arrow">▼</span>`;
    }
}

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

    const btn = selector.querySelector('#currentLangBtn');
    const dropdown = selector.querySelector('#langDropdown');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
    });

    selector.querySelectorAll('.lang-option').forEach(option => {
        option.addEventListener('click', async () => {
            const lang = option.getAttribute('data-lang');
            await changeLanguage(lang);
            selector.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
            option.classList.add('active');
            dropdown.classList.remove('visible');
        });
    });

    document.addEventListener('click', () => {
        dropdown.classList.remove('visible');
    });
}

window.i18n = {
    init: initI18n,
    t,
    changeLanguage,
    createLanguageSelector,
    getCurrentLang: () => currentLang,
    getLanguages: () => LANGUAGES
};
