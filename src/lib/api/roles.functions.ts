import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KontaktOsobe, Role } from "@/lib/airtable/sdk.server";
import { memoize } from "@/lib/airtable/cache.server";

export const PERMISSION_FIELDS = [
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
  "viewReports",
  "manageUsers",
  "manageSettings",
  "manageReasonCodes",
  "manageFactoryScope",
  "canComment",
] as const;
export type PermissionField = (typeof PERMISSION_FIELDS)[number];

export interface RolePermissionsRow {
  id: string;
  naziv: string;
  description?: string;
  permissions: Record<PermissionField, boolean>;
}

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
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

export const listRolePermissionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ roles: RolePermissionsRow[] }> => {
    const res = await Role.findAll({ limit: 100 });
    const roles: RolePermissionsRow[] = (res.records as any[])
      .filter((r) => r.naziv)
      .map((r) => {
        const perms = {} as Record<PermissionField, boolean>;
        for (const f of PERMISSION_FIELDS) perms[f] = r[f] === true;
        return {
          id: r.id,
          naziv: String(r.naziv),
          description: r.description ? String(r.description) : undefined,
          permissions: perms,
        };
      });
    // Stable sort by name
    roles.sort((a, b) => a.naziv.localeCompare(b.naziv, "sr"));
    return { roles };
  },
);

const UpdatePermSchema = z.object({
  roleId: z.string().min(1),
  field: z.enum(PERMISSION_FIELDS),
  value: z.boolean(),
  currentUserId: z.string().min(1),
});

export const updateRolePermissionFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => UpdatePermSchema.parse(d))
  .handler(async ({ data }) => {
    const callerName = norm(await getCallerRoleName(data.currentUserId));
    if (callerName !== "super admin" && callerName !== "admin") {
      throw new Error("Nemate dozvolu za izmenu permisija.");
    }
    const target = await Role.findOne({ id: data.roleId });
    const targetName = norm((target as any)?.naziv);
    if (callerName === "admin" && (targetName === "admin" || targetName === "super admin")) {
      throw new Error("Admin ne može menjati Admin niti Super Admin role.");
    }
    await Role.update({ id: data.roleId, record: { [data.field]: data.value } as any });
    return { success: true };
  });
