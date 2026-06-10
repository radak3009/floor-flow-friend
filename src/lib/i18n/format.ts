import i18n from "./index";

function locale(): string {
  return i18n.language?.startsWith("en") ? "en-US" : "sr-Latn-RS";
}

export function formatDate(d: Date | string | number | undefined | null): string {
  if (d == null || d === "") return "—";
  try { return new Date(d).toLocaleDateString(locale()); } catch { return String(d); }
}

export function formatDateTime(d: Date | string | number | undefined | null): string {
  if (d == null || d === "") return "—";
  try {
    const x = new Date(d);
    return `${x.toLocaleDateString(locale())} ${x.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}`;
  } catch { return String(d); }
}

export function formatNumber(n: number | undefined | null, opts?: Intl.NumberFormatOptions): string {
  if (n == null || Number.isNaN(n)) return "—";
  try { return n.toLocaleString(locale(), opts); } catch { return String(n); }
}

/** Vrati naziv u trenutnom jeziku (en → nameEn ako postoji, inače srpski naziv). */
export function pickName(item: { naziv: string; nameEn?: string }, lang?: string): string {
  const l = (lang ?? i18n.language ?? "sr").toString();
  if (l.startsWith("en") && item.nameEn && item.nameEn.trim()) return item.nameEn;
  return item.naziv;
}
