import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async () => {
        const { data } = await supabaseAdmin
          .from("pwa_config")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        const name = data?.name ?? "MES Shop Floor";
        const shortName = data?.short_name ?? "MES";
        const themeColor = data?.theme_color ?? "#1f2937";
        const backgroundColor = data?.background_color ?? "#1f2937";
        const icon192 = data?.icon_192_url ?? "/icon-192.png";
        const icon512 = data?.icon_512_url ?? "/icon-512.png";

        const manifest = {
          name,
          short_name: shortName,
          description:
            "Shop Floor Panda interacts with Airtable MES to manage production orders, track progress, and record scrap.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "any",
          theme_color: themeColor,
          background_color: backgroundColor,
          icons: [
            { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
            { src: icon512, sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        };

        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=60, must-revalidate",
          },
        });
      },
    },
  },
});
