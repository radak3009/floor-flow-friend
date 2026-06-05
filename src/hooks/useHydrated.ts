import { useEffect, useState } from "react";

/** Vraća true tek nakon prve klijentske hidracije. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
