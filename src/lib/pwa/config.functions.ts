import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { KontaktOsobe, Role } from "@/lib/airtable/sdk.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const firstId = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.startsWith("rec") ? x : undefined;
};

async function assertAdmin(currentUserId: string): Promise<void> {
  if (!currentUserId) throw new Error("Unauthorized");
  const u = await KontaktOsobe.findOne({ id: currentUserId });
  if (!u) throw new Error("Unauthorized");
  const roleId = firstId((u as any).uloga);
  if (!roleId) throw new Error("Nemate dozvolu (Admin only).");
  const r = await Role.findOne({ id: roleId });
  const name = (r as any)?.naziv ? String((r as any).naziv).trim().toLowerCase() : "";
  if (name !== "admin" && name !== "super admin") {
    throw new Error("Nemate dozvolu (Admin only).");
  }
}

export interface PwaConfig {
  name: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  icon192Url: string | null;
  icon512Url: string | null;
  updatedAt: string;
}

const DEFAULTS: PwaConfig = {
  name: "MES Shop Floor",
  shortName: "MES",
  themeColor: "#1f2937",
  backgroundColor: "#1f2937",
  icon192Url: null,
  icon512Url: null,
  updatedAt: new Date(0).toISOString(),
};

async function readConfig(): Promise<PwaConfig> {
  const { data, error } = await supabaseAdmin
    .from("pwa_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULTS;
  return {
    name: data.name,
    shortName: data.short_name,
    themeColor: data.theme_color,
    backgroundColor: data.background_color,
    icon192Url: data.icon_192_url,
    icon512Url: data.icon_512_url,
    updatedAt: data.updated_at,
  };
}

export const getPwaConfigFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PwaConfig> => readConfig(),
);

const HEX = /^#[0-9a-fA-F]{6}$/;

const UpdateSchema = z.object({
  currentUserId: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  shortName: z.string().trim().min(1).max(20),
  themeColor: z.string().regex(HEX, "Boja mora biti u formatu #RRGGBB"),
  backgroundColor: z.string().regex(HEX, "Boja mora biti u formatu #RRGGBB"),
});

export const updatePwaConfigFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data }): Promise<PwaConfig> => {
    await assertAdmin(data.currentUserId);
    const { error } = await supabaseAdmin
      .from("pwa_config")
      .upsert({
        id: 1,
        name: data.name,
        short_name: data.shortName,
        theme_color: data.themeColor,
        background_color: data.backgroundColor,
        updated_at: new Date().toISOString(),
        updated_by: data.currentUserId,
      });
    if (error) throw new Error(error.message);
    return readConfig();
  });

const UploadSchema = z.object({
  currentUserId: z.string().min(1),
  icon192Base64: z.string().min(10),
  icon512Base64: z.string().min(10),
});

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Neispravan format slike.");
  const contentType = m[1];
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

export const uploadPwaIconsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => UploadSchema.parse(d))
  .handler(async ({ data }): Promise<{ icon192Url: string; icon512Url: string }> => {
    await assertAdmin(data.currentUserId);
    const ts = Date.now();
    const i192 = decodeDataUrl(data.icon192Base64);
    const i512 = decodeDataUrl(data.icon512Base64);

    if (i192.bytes.byteLength > 512 * 1024) throw new Error("192 ikonica je prevelika.");
    if (i512.bytes.byteLength > 2 * 1024 * 1024) throw new Error("512 ikonica je prevelika.");

    const p192 = `icon-192-${ts}.png`;
    const p512 = `icon-512-${ts}.png`;

    const up192 = await supabaseAdmin.storage
      .from("pwa-icons")
      .upload(p192, i192.bytes, { contentType: "image/png", upsert: true });
    if (up192.error) throw new Error(up192.error.message);

    const up512 = await supabaseAdmin.storage
      .from("pwa-icons")
      .upload(p512, i512.bytes, { contentType: "image/png", upsert: true });
    if (up512.error) throw new Error(up512.error.message);

    const url192 = supabaseAdmin.storage.from("pwa-icons").getPublicUrl(p192).data.publicUrl;
    const url512 = supabaseAdmin.storage.from("pwa-icons").getPublicUrl(p512).data.publicUrl;

    const { error } = await supabaseAdmin
      .from("pwa_config")
      .upsert({
        id: 1,
        icon_192_url: url192,
        icon_512_url: url512,
        updated_at: new Date().toISOString(),
        updated_by: data.currentUserId,
      });
    if (error) throw new Error(error.message);

    return { icon192Url: url192, icon512Url: url512 };
  });

const ResetSchema = z.object({ currentUserId: z.string().min(1) });

export const resetPwaConfigFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ResetSchema.parse(d))
  .handler(async ({ data }): Promise<PwaConfig> => {
    await assertAdmin(data.currentUserId);
    const { error } = await supabaseAdmin
      .from("pwa_config")
      .upsert({
        id: 1,
        name: "MES Shop Floor",
        short_name: "MES",
        theme_color: "#1f2937",
        background_color: "#1f2937",
        icon_192_url: null,
        icon_512_url: null,
        updated_at: new Date().toISOString(),
        updated_by: data.currentUserId,
      });
    if (error) throw new Error(error.message);
    return readConfig();
  });
