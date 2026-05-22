import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';

const savedLanguage = typeof window !== 'undefined' 
  ? localStorage.getItem('language') || 'en' 
  : 'en';

const languageImports: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import('./es.json'),
  fr: () => import('./fr.json'),
  ar: () => import('./ar.json'),
  zh: () => import('./zh.json'),
  hi: () => import('./hi.json'),
  bn: () => import('./bn.json'),
};

async function loadLanguage(lang: string) {
  if (lang === 'en') return { translation: en };
  if (languageImports[lang]) {
    const module = await languageImports[lang]();
    return { translation: module.default };
  }
  return { translation: en };
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

loadLanguage(savedLanguage).then((resources) => {
  if (savedLanguage !== 'en') {
    i18n.addResourceBundle(savedLanguage, 'translation', resources.translation, true, true);
  }
});

export const changeLanguage = async (lang: string) => {
  const currentLang = i18n.language;
  
  if (currentLang !== lang) {
    await i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
    
    if (!i18n.getResourceBundle(lang, 'translation')) {
      const resources = await loadLanguage(lang);
      i18n.addResourceBundle(lang, 'translation', resources.translation, true, true);
    }
  }
  
  if (lang === 'ar' || lang === 'he') {
    document.documentElement.dir = 'rtl';
  } else {
    document.documentElement.dir = 'ltr';
  }
};

export const preloadLanguage = async (lang: string) => {
  if (lang !== 'en' && !i18n.getResourceBundle(lang, 'translation')) {
    const resources = await loadLanguage(lang);
    i18n.addResourceBundle(lang, 'translation', resources.translation, true, true);
  }
};

export const languages = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩' },
];

export default i18n;