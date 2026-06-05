/**
 * Slack DM helper — server only.
 * Uses Lovable Slack connector gateway. Silently no-ops if connector isn't linked.
 */
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

export function isSlackConfigured(): boolean {
  return !!process.env.LOVABLE_API_KEY && !!process.env.SLACK_API_KEY;
}

export async function sendSlackDM(slackUserId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSlackConfigured()) return { ok: false, error: "slack_not_configured" };
  try {
    // 1) Open IM channel with the user
    const openRes = await fetch(`${GATEWAY_URL}/conversations.open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.SLACK_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: slackUserId }),
    });
    const openData: any = await openRes.json();
    if (!openData.ok) return { ok: false, error: `conversations.open: ${openData.error}` };
    const channel = openData.channel?.id;
    if (!channel) return { ok: false, error: "no channel id" };

    // 2) Post the message
    const msgRes = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": process.env.SLACK_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text }),
    });
    const msgData: any = await msgRes.json();
    if (!msgData.ok) return { ok: false, error: `chat.postMessage: ${msgData.error}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "unknown" };
  }
}
