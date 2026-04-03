// Auto Refresh & Page Monitor with Telegram Alerts - Internationalization Module
// Hybrid approach: uses Chrome _locales messages.json format
// but supports runtime language switching via fetch

const LANGUAGES = {
    it: { name: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}', dir: 'ltr', chrome: 'it' },
    en: { name: 'English', flag: '\u{1F1EC}\u{1F1E7}', dir: 'ltr', chrome: 'en' },
    fr: { name: 'Français', flag: '\u{1F1EB}\u{1F1F7}', dir: 'ltr', chrome: 'fr' },
    de: { name: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}', dir: 'ltr', chrome: 'de' },
    es: { name: 'Español', flag: '\u{1F1EA}\u{1F1F8}', dir: 'ltr', chrome: 'es' },
    pt: { name: 'Português', flag: '\u{1F1F5}\u{1F1F9}', dir: 'ltr', chrome: 'pt_BR' },
    pl: { name: 'Polski', flag: '\u{1F1F5}\u{1F1F1}', dir: 'ltr', chrome: 'pl' },
    uk: { name: 'Українська', flag: '\u{1F1FA}\u{1F1E6}', dir: 'ltr', chrome: 'uk' },
    ar: { name: 'العربية', flag: '\u{1F1F8}\u{1F1E6}', dir: 'rtl', chrome: 'ar' }
};

const LANGUAGE_ARROW = '\u25BE';

let currentLang = 'it';
let translations = {};

async function initI18n() {
    const result = await chrome.storage.sync.get(['selectedLanguage']);
    currentLang = result.selectedLanguage || detectBrowserLanguage();
    await loadTranslations(currentLang);
    applyTranslations();
    document.documentElement.lang = currentLang;
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
        const url = chrome.runtime.getURL(`i18n/${chromeCode}/messages.json`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status}`);
        }

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

// Get translation by key path (e.g., 'status.active' -> 'status_active')
function t(keyPath, fallback = '') {
    const flatKey = keyPath.replace(/\./g, '_');
    return translations[flatKey] || fallback || keyPath;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((element) => {
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

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        element.placeholder = t(element.getAttribute('data-i18n-placeholder'));
    });

    document.querySelectorAll('[data-i18n-tooltip]').forEach((element) => {
        element.setAttribute('data-tooltip', t(element.getAttribute('data-i18n-tooltip')));
    });
}

async function changeLanguage(lang) {
    if (!LANGUAGES[lang]) {
        return;
    }

    await loadTranslations(lang);
    await chrome.storage.sync.set({ selectedLanguage: lang });
    applyTranslations();
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].dir;
    updateLanguageSelector();
    return lang;
}

function updateLanguageSelector() {
    const btn = document.getElementById('currentLangBtn');
    if (btn) {
        btn.innerHTML = `${LANGUAGES[currentLang].flag} <span class="lang-arrow">${LANGUAGE_ARROW}</span>`;
    }
}

function createLanguageSelector(container) {
    const selector = document.createElement('div');
    selector.className = 'language-selector';
    selector.innerHTML = `
        <button id="currentLangBtn" class="lang-btn">
            ${LANGUAGES[currentLang].flag} <span class="lang-arrow">${LANGUAGE_ARROW}</span>
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

    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        dropdown.classList.toggle('visible');
    });

    selector.querySelectorAll('.lang-option').forEach((option) => {
        option.addEventListener('click', async () => {
            const lang = option.getAttribute('data-lang');
            await changeLanguage(lang);
            selector.querySelectorAll('.lang-option').forEach((item) => item.classList.remove('active'));
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
