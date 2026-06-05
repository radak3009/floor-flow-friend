import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KontaktOsobe, Role } from "@/lib/airtable/sdk.server";
import { memoize } from "@/lib/airtable/cache.server";

export interface UserRow {
  id: string;
  idZaposlenog: string;
  imeIPrezime: string;
  pozicija?: string;
  aktivan: boolean;
  roleId?: string;
  roleName?: string;
}

export interface RoleRow {
  id: string;
  naziv: string;
}

const pickStr = (v: unknown): string | undefined => {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" ? v : v != null ? String(v) : undefined;
};
const firstId = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.startsWith("rec") ? x : undefined;
};

async function getCallerRoleName(currentUserId: string): Promise<string | null> {
  return memoize(`caller-role:${currentUserId}`, 30_000, async () => {
    const u = await KontaktOsobe.findOne({ id: currentUserId });
    if (!u) return null;
    const roleId = firstId((u as any).uloga);
    if (!roleId) return null;
    const r = await Role.findOne({ id: roleId });
    return (r as any)?.naziv ? String((r as any).naziv) : null;
  });
}

function isSuperAdmin(name: string | null): boolean {
  return !!name && name.trim().toLowerCase() === "super admin";
}
function isAdmin(name: string | null): boolean {
  return !!name && name.trim().toLowerCase() === "admin";
}

async function assertCanEditTargetRole(currentUserId: string, targetRoleId: string | undefined) {
  const callerName = await getCallerRoleName(currentUserId);
  if (isSuperAdmin(callerName)) return;
  if (!isAdmin(callerName)) throw new Error("Nemate dozvolu za ovu izmenu.");
  if (!targetRoleId) return;
  const target = await Role.findOne({ id: targetRoleId });
  const t = (target as any)?.naziv ? String((target as any).naziv).trim().toLowerCase() : "";
  if (t === "admin" || t === "super admin") {
    throw new Error("Admin ne može menjati Admin niti Super Admin role.");
  }
}

export const listUsersFn = createServerFn({ method: "GET" }).handler(async (): Promise<{ users: UserRow[] }> => {
  const [usersRes, rolesRes] = await Promise.all([
    KontaktOsobe.findAll({ limit: 500 }),
    Role.findAll({ limit: 100 }),
  ]);
  const roleMap = new Map<string, string>();
  for (const r of rolesRes.records as any[]) if (r.naziv) roleMap.set(r.id, String(r.naziv));

  const users: UserRow[] = (usersRes.records as any[]).map((u) => {
    const roleId = firstId(u.uloga);
    return {
      id: u.id,
      idZaposlenog: pickStr(u.idZaposlenog) ?? "",
      imeIPrezime: pickStr(u.imeIPrezime) ?? "",
      pozicija: pickStr(u.pozicija),
      aktivan: u.aktivan !== false,
      roleId,
      roleName: roleId ? roleMap.get(roleId) : undefined,
    };
  });
  // Stable sort by name
  users.sort((a, b) => a.imeIPrezime.localeCompare(b.imeIPrezime, "sr"));
  return { users };
});

export const listRolesFn = createServerFn({ method: "GET" }).handler(async (): Promise<{ roles: RoleRow[] }> => {
  const res = await Role.findAll({ limit: 100 });
  const roles: RoleRow[] = (res.records as any[])
    .filter((r) => r.naziv)
    .map((r) => ({ id: r.id, naziv: String(r.naziv) }));
  return { roles };
});

const UpdateRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
  currentUserId: z.string().min(1),
});

export const updateUserRoleFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => UpdateRoleSchema.parse(d))
  .handler(async ({ data }) => {
    // Get current role of target user to validate caller permissions
    const target = await KontaktOsobe.findOne({ id: data.userId });
    const currentRoleId = firstId((target as any)?.uloga);
    // Caller must be allowed to edit BOTH old and new role's user
    await assertCanEditTargetRole(data.currentUserId, currentRoleId);
    await assertCanEditTargetRole(data.currentUserId, data.roleId);
    await KontaktOsobe.update({ id: data.userId, record: { uloga: [data.roleId] } as any });
    return { success: true };
  });

const ToggleActiveSchema = z.object({
  userId: z.string().min(1),
  aktivan: z.boolean(),
  currentUserId: z.string().min(1),
});

export const toggleUserActiveFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ToggleActiveSchema.parse(d))
  .handler(async ({ data }) => {
    const target = await KontaktOsobe.findOne({ id: data.userId });
    const currentRoleId = firstId((target as any)?.uloga);
    await assertCanEditTargetRole(data.currentUserId, currentRoleId);
    await KontaktOsobe.update({ id: data.userId, record: { aktivan: data.aktivan } as any });
    return { success: true };
  });
