import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { KontaktOsobe, Role, PrijaveNaSistem } from "@/lib/airtable/sdk.server";
import { verifyPin } from "@/lib/auth/pin-hash.server";
import { checkLockout, recordAttempt, clientIp, type AttemptReason } from "@/lib/auth/login-throttle.server";
import { signSession, verifySessionAllowExpired, readPinSessionToken } from "@/lib/auth/pin-session.server";

const PermissionFields = [
  "viewAssignedMachines",
  "viewAllFactoryMachines",
  "startWorkOrder",
  "pauseWorkOrder",
  "resumeWorkOrder",
  "stopWorkOrder",
  "resetStart",
  "logScrap",
  "deleteScrap",
  "logDowntime",
  "confirmBatch",
  "performInspection",
  "viewHistory",
  "manageUsers",
  "manageSettings",
  "manageReasonCodes",
  "viewReports",
  "manageFactoryScope",
  "canComment",
] as const;

const InputSchema = z.object({
  idZaposlenog: z.string().min(1).max(64),
  pin: z.string().min(1).max(64),
  uredaj: z.string().max(32).optional(),
});

type PermissionMap = Record<(typeof PermissionFields)[number], boolean>;

function buildPermissions(role: any): PermissionMap {
  return Object.fromEntries(PermissionFields.map((f) => [f, role?.[f] === true])) as PermissionMap;
}

const getCI = (obj: any, key: string): any => {
  if (obj == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const lower = key.toLowerCase();
  const k = Object.keys(obj).find((x) => x.toLowerCase() === lower);
  return k ? obj[k] : undefined;
};

const GENERIC_CREDENTIAL_ERROR = "Pogrešan ID zaposlenog ili PIN";

export const loginFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const idZ = data.idZaposlenog.trim();
    const uredaj = data.uredaj;
    let ip: string | undefined;
    try {
      const req = getRequest();
      if (req?.headers) ip = clientIp(req.headers);
    } catch {
      /* SSR-safe */
    }

    const finishAttempt = (success: boolean, reason: AttemptReason) =>
      recordAttempt({ idZaposlenog: idZ, uredaj, ip, success, reason });

    // 1) Lockout provera
    const lock = await checkLockout(idZ);
    if (lock.locked) {
      await finishAttempt(false, "locked_out");
      return {
        success: false as const,
        error: `Previše neuspelih pokušaja. Pokušajte ponovo za ${lock.retryAfterSec}s.`,
      };
    }

    // 2) Učitaj SAMO korisnika sa traženim idZaposlenog (1 record umesto 500)
    const result = await KontaktOsobe.findAll({ filters: { idZaposlenog: idZ }, limit: 2 });
    const kontakt = result.records.find((k: any) => String(getCI(k, "idZaposlenog") ?? "").trim() === idZ);

    if (!kontakt) {
      await finishAttempt(false, "unknown_user");
      return { success: false as const, error: GENERIC_CREDENTIAL_ERROR };
    }
    if (getCI(kontakt, "aktivan") === false) {
      await finishAttempt(false, "inactive");
      return { success: false as const, error: "Nalog nije aktivan. Kontaktirajte administratora." };
    }

    const storedPin = String(getCI(kontakt, "pin") ?? "");
    const inputPin = data.pin.trim();
    const ok = await verifyPin(inputPin, storedPin);
    if (!ok) {
      await finishAttempt(false, "bad_pin");
      return { success: false as const, error: GENERIC_CREDENTIAL_ERROR };
    }

    const ulogaVal = getCI(kontakt, "uloga");
    const roleId = Array.isArray(ulogaVal) ? (ulogaVal[0] as string | undefined) : (ulogaVal as string | undefined);

    if (!roleId) {
      await finishAttempt(false, "no_role");
      return { success: false as const, error: "Korisnik nema dodeljenu ulogu" };
    }

    // PERF: čitanje uloge i upis prijave idu PARALELNO (dva nezavisna
    // Airtable poziva) — skraćuje login za vreme jednog round-trip-a.
    // Upis prijave je i dalje soft-fail (login ne sme da padne zbog loga).
    const rolePromise = Role.findOne({ id: roleId }).catch(() => null);
    const prijavaPromise = (async () => {
      try {
        const prijava = await PrijaveNaSistem.create({
          record: {
            datumIVremePrijave: new Date().toISOString(),
            korisnik: [kontakt.id],
            ...(uredaj ? { ureaj: uredaj } : {}),
          },
        });
        return prijava.id;
      } catch (e) {
        console.warn(
          `[soft-fail] PrijaveNaSistem.create — upis prijave nije uspeo. Proveri: (1) PAT data.records:write scope, (2) obavezna polja u tabeli, (3) mapiranje 'korisnik' linka. Greška:`,
          e instanceof Error ? e.message : e,
        );
        return "";
      }
    })();

    const [role, prijavaId] = await Promise.all([rolePromise, prijavaPromise]);
    if (!role) {
      await finishAttempt(false, "no_role");
      return { success: false as const, error: "Uloga nije pronađena" };
    }

    const permissions = buildPermissions(role);

    await finishAttempt(true, "ok");

    const token = await signSession({ userId: kontakt.id, roleId, prijavaId });

    return {
      success: true as const,
      token,
      user: {
        id: kontakt.id,
        idZaposlenog: idZ,
        imeIPrezime: (getCI(kontakt, "imeIPrezime") as string) || idZ,
        roleId,
        roleName: (role.naziv as string) || "Korisnik",
        prijavaId,
        permissions,
      },
    };
  });

export const logoutFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ prijavaId: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    if (!data.prijavaId) return { success: true };
    try {
      await PrijaveNaSistem.update({ id: data.prijavaId, record: { datumIVremeOdjave: new Date().toISOString() } });
    } catch (e) {
      console.warn(
        `[soft-fail] PrijaveNaSistem.update — beleženje odjave nije uspelo (prijavaId=${data.prijavaId}). Proveri PAT write scope. Greška:`,
        e instanceof Error ? e.message : e,
      );
    }
    return { success: true };
  });

const RefreshSchema = z.object({ userId: z.string().min(1).max(64).optional() });

// Koliko dugo nakon isteka tokena i dalje dozvoljavamo "sliding" refresh.
// Potpis tokena mora biti validan; ovo samo ograničava starost. Tablet koji
// nije otvorio aplikaciju duže od ovoga mora ponovo da unese PIN.
const REFRESH_GRACE_SEC = 30 * 24 * 60 * 60; // 30 dana

export const refreshSessionFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => RefreshSchema.parse(d))
  .handler(async () => {
    // BEZBEDNOST: identitet se čita ISKLJUČIVO iz potpisanog tokena u
    // zaglavlju (attachPinSession ga šalje uz svaki poziv), nikad iz
    // klijentskog payload-a — inače bi bilo ko mogao da "osveži" sesiju
    // proizvoljnog korisnika samo pogađanjem ID-a zapisa.
    let headerToken = "";
    try {
      const req = getRequest();
      headerToken = readPinSessionToken(req?.headers);
    } catch {
      /* SSR-safe */
    }
    const payload = await verifySessionAllowExpired(headerToken, REFRESH_GRACE_SEC);
    if (!payload) return { invalid: true as const };
    const userId = payload.userId;

    const kontakt = await KontaktOsobe.findOne({ id: userId }).catch(() => null);
    if (!kontakt) return { invalid: true as const };
    if (getCI(kontakt, "aktivan") === false) return { invalid: true as const };

    const ulogaVal = getCI(kontakt, "uloga");
    const roleId = Array.isArray(ulogaVal) ? (ulogaVal[0] as string | undefined) : (ulogaVal as string | undefined);
    if (!roleId) return { invalid: true as const };

    const role = await Role.findOne({ id: roleId }).catch(() => null);
    if (!role) return { invalid: true as const };

    // Izdaj sveži token uz svaki refresh (sliding expiration).
    const token = await signSession({ userId, roleId, prijavaId: payload.prijavaId });

    return {
      invalid: false as const,
      token,
      roleId,
      roleName: ((role as any).naziv as string) || "Korisnik",
      imeIPrezime: (getCI(kontakt, "imeIPrezime") as string) || "",
      permissions: buildPermissions(role),
    };
  });
