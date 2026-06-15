// Helpers for scrap dialogs.
// "Masa škarta (kg)" polje je uslovljeno odabranim tipom škarta.
const MASS_TRIGGER_TIP_NAMES = [
  "pogaca - pokretanje linije",
  "pogaca - promena boje",
];

function normalizeTipName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (č→c, š→s, ć→c)
    .replace(/[\u2010-\u2015\u2212]/g, "-") // various dashes → ASCII hyphen
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function isMassScrapTipName(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = normalizeTipName(name);
  return MASS_TRIGGER_TIP_NAMES.includes(n);
}
