import { createFileRoute } from "@tanstack/react-router";
import { getWebhookByKey, verifyMac } from "@/lib/airtable/webhooks.server";
import { sharedInvalidate } from "@/lib/airtable/shared-cache.server";

/**
 * Airtable webhook callback. Verifikuje MAC pa invalidira deljeni keš.
 * URL: https://<host>/api/public/airtable-webhook/monitoring
 */
export const Route = createFileRoute("/api/public/airtable-webhook/monitoring")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const macHeader = request.headers.get("x-airtable-content-mac");

        const hook = await getWebhookByKey("monitoring");
        if (!hook) {
          return new Response("Webhook nije registrovan", { status: 503 });
        }
        const ok = await verifyMac(rawBody, macHeader, hook.macSecret);
        if (!ok) {
          return new Response("Invalid MAC", { status: 401 });
        }

        // Promena u Monitoring/RadniNalozi tabeli — invalidiraj sve relevantne ulaze.
        await Promise.all([
          sharedInvalidate("dashboard"),
          sharedInvalidate("available-wo"),
        ]);

        return new Response("ok", { status: 200 });
      },
      GET: async () => new Response("ok"),
    },
  },
});
