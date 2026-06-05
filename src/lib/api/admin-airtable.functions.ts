import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePinSession } from "@/lib/auth/pin-session.server";
import {
  registerWebhook,
  deleteWebhook,
  listRegisteredWebhooks,
} from "@/lib/airtable/webhooks.server";
import { loadActiveConfig } from "@/lib/airtable/config.server";
import { AIRTABLE_BASE_ID, TABLES as STATIC_TABLES } from "@/lib/airtable/schema";

const SetupSchema = z.object({
  notificationBaseUrl: z.string().url().max(512),
});

function resolveTableId(name: keyof typeof STATIC_TABLES, cfgTables?: Record<string, string> | null): string | undefined {
  if (cfgTables && cfgTables[name as string]) return cfgTables[name as string];
  return (STATIC_TABLES as any)[name];
}

export const setupAirtableWebhooksFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((d: unknown) => SetupSchema.parse(d))
  .handler(async ({ data }) => {
    const cfg = await loadActiveConfig();
    const baseId = cfg?.baseId ?? AIRTABLE_BASE_ID;
    const monitoringTableId = resolveTableId("Monitoring", cfg?.tables);
    if (!monitoringTableId) {
      throw new Error("Monitoring table ID nije pronađen u Airtable šemi");
    }

    const url = `${data.notificationBaseUrl.replace(/\/+$/, "")}/api/public/airtable-webhook/monitoring`;

    const hook = await registerWebhook({
      key: "monitoring",
      tableId: monitoringTableId,
      notificationUrl: url,
    });

    return {
      success: true as const,
      baseId,
      webhook: { id: hook.id, notificationUrl: hook.notificationUrl, tableId: hook.tableId },
    };
  });

export const removeAirtableWebhookFn = createServerFn({ method: "POST" })
  .middleware([requirePinSession])
  .inputValidator((d: unknown) => z.object({ key: z.string().min(1).max(64) }).parse(d))
  .handler(async ({ data }) => {
    await deleteWebhook(data.key);
    return { success: true as const };
  });

export const listAirtableWebhooksFn = createServerFn({ method: "GET" })
  .middleware([requirePinSession])
  .handler(async () => {
    const items = await listRegisteredWebhooks();
    return {
      items: items.map((it) => ({
        key: it.key,
        id: it.id,
        tableId: it.tableId,
        notificationUrl: it.notificationUrl,
        createdAt: it.createdAt,
      })),
    };
  });
