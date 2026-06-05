import { useTranslation } from "react-i18next";
import { setAppLang, type AppLang } from "@/lib/i18n";

export function LanguageToggle({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (i18n.language?.startsWith("en") ? "en" : "sr") as AppLang;

  const opt = (lang: AppLang, label: string) => {
    const active = current === lang;
    return (
      <button
        type="button"
        key={lang}
        onClick={() => setAppLang(lang)}
        className={`h-9 px-3 text-sm font-medium transition rounded-md ${
          active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
        }`}
        aria-pressed={active}
      >
        {label}
      </button>
    );
  };

  return (
    <div className={`inline-flex items-center gap-1 p-1 rounded-md bg-secondary border border-border ${className ?? ""}`}>
      {opt("sr", "SR")}
      {opt("en", "EN")}
    </div>
  );
}

export default LanguageToggle;
