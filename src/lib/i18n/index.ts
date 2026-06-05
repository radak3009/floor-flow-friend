import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import sr from "./locales/sr.json";
import en from "./locales/en.json";

export const SUPPORTED_LANGS = ["sr", "en"] as const;
export type AppLang = (typeof SUPPORTED_LANGS)[number];
export const LANG_STORAGE_KEY = "app.lang";

function detectInitialLang(): AppLang {
  if (typeof window === "undefined") return "sr";
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "sr" || saved === "en") return saved;
  } catch { /* noop */ }
  return "sr";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      sr: { translation: sr },
      en: { translation: en },
    },
    lng: detectInitialLang(),
    fallbackLng: "sr",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function setAppLang(lang: AppLang) {
  try { window.localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* noop */ }
  void i18n.changeLanguage(lang);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", lang);
  }
}

export default i18n;
