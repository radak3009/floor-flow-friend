import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { KontaktOsobe } from "@/lib/airtable/sdk.server";
import { sendSlackDM } from "@/lib/slack.server";

export type EntityType = "work_order";

export interface CommentRow {
  id: string;
  entityType: string;
  entityId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string | null;
  payload: Record<string, string | number | boolean | null>;
  readAt: string | null;
  createdAt: string;
}

export interface MentionableUser {
  id: string;
  imeIPrezime: string;
}

// ---------- List comments ----------
const ListSchema = z.object({
  entityType: z.enum(["work_order"]),
  entityId: z.string().min(1).max(64),
});

export const listCommentsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ListSchema.parse(d))
  .handler(async ({ data }): Promise<{ items: CommentRow[] }> => {
    const { data: rows, error } = await supabaseAdmin
      .from("comments")
      .select("*")
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return {
      items: (rows || []).map((r: any) => ({
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        authorId: r.author_id,
        authorName: r.author_name,
        body: r.body,
        mentions: r.mentions || [],
        createdAt: r.created_at,
      })),
    };
  });

// ---------- Post comment ----------
const PostSchema = z.object({
  entityType: z.enum(["work_order"]),
  entityId: z.string().min(1).max(64),
  entityLabel: z.string().min(1).max(128), // e.g. broj naloga "WO-12345"
  authorId: z.string().min(1).max(64),
  authorName: z.string().min(1).max(128),
  body: z.string().min(1).max(4000),
});

// Mention token format used by the client: @[Display Name](recXXXX)
const MENTION_RX = /@\[([^\]]+)\]\((rec[a-zA-Z0-9]+)\)/g;

function extractMentions(body: string): { ids: string[]; plain: string } {
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(MENTION_RX.source, "g");
  while ((m = rx.exec(body)) !== null) {
    if (!ids.includes(m[2])) ids.push(m[2]);
  }
  const plain = body.replace(MENTION_RX, "@$1");
  return { ids, plain };
}

export const postCommentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => PostSchema.parse(d))
  .handler(async ({ data }) => {
    const { ids: mentionIds, plain } = extractMentions(data.body);

    // 1) Insert comment
    const { data: inserted, error } = await supabaseAdmin
      .from("comments")
      .insert({
        entity_type: data.entityType,
        entity_id: data.entityId,
        author_id: data.authorId,
        author_name: data.authorName,
        body: data.body,
        mentions: mentionIds,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    // 2) For each mentioned user (except self): create notification + Slack DM (best effort)
    const targets = mentionIds.filter((id) => id !== data.authorId);
    if (targets.length > 0) {
      // Insert in-app notifications
      const notifRows = targets.map((uid) => ({
        user_id: uid,
        type: "mention",
        entity_type: data.entityType,
        entity_id: data.entityId,
        title: `${data.authorName} vas je pomenuo · Nalog ${data.entityLabel}`,
        body: plain.slice(0, 500),
        payload: { commentId: inserted.id, entityLabel: data.entityLabel },
      }));
      const { error: nErr } = await supabaseAdmin.from("notifications").insert(notifRows);
      if (nErr) console.warn("notification insert failed:", nErr.message);

      // Slack DM mirror (fire and forget per user)
      await Promise.all(
        targets.map(async (uid) => {
          try {
            const u = await KontaktOsobe.findOne({ id: uid });
            const slackId = (u as any)?.slackId ? String((u as any).slackId).trim() : "";
            if (!slackId) return;
            const text =
              `*${data.authorName}* vas je pomenuo u nalogu *${data.entityLabel}*:\n` +
              `> ${plain.replace(/\n/g, "\n> ")}`;
            const res = await sendSlackDM(slackId, text);
            if (!res.ok) console.warn(`Slack DM to ${uid} failed:`, res.error);
          } catch (e: any) {
            console.warn(`Slack DM to ${uid} threw:`, e?.message);
          }
        })
      );
    }

    return { id: inserted.id as string };
  });

// ---------- Delete comment ----------
const DeleteSchema = z.object({
  commentId: z.string().uuid(),
  authorId: z.string().min(1).max(64), // must match
});

export const deleteCommentFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => DeleteSchema.parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("comments")
      .delete()
      .eq("id", data.commentId)
      .eq("author_id", data.authorId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ---------- List notifications (mine) ----------
const ListNotifSchema = z.object({
  userId: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(100).optional(),
});

export const listMyNotificationsFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ListNotifSchema.parse(d))
  .handler(async ({ data }): Promise<{ items: NotificationRow[] }> => {
    // Best-effort retention: prune read notifications older than 30 days for this user.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("user_id", data.userId)
        .not("read_at", "is", null)
        .lt("read_at", cutoff);
    } catch (e) {
      console.warn("notifications retention prune failed:", e);
    }

    const { data: rows, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 60);
    if (error) throw new Error(error.message);
    return {
      items: (rows || []).map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        type: r.type,
        entityType: r.entity_type,
        entityId: r.entity_id,
        title: r.title,
        body: r.body,
        payload: r.payload || {},
        readAt: r.read_at,
        createdAt: r.created_at,
      })),
    };
  });


// ---------- Mark notifications read ----------
const MarkReadSchema = z.object({
  userId: z.string().min(1).max(64),
  notificationId: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => MarkReadSchema.parse(d))
  .handler(async ({ data }) => {
    const now = new Date().toISOString();
    let q = supabaseAdmin.from("notifications").update({ read_at: now }).eq("user_id", data.userId).is("read_at", null);
    if (data.notificationId && !data.all) q = q.eq("id", data.notificationId);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ---------- Mentionable users (cached via Airtable) ----------
export const listMentionableUsersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ users: MentionableUser[] }> => {
    const { memoize } = await import("@/lib/airtable/cache.server");
    return memoize("mentionable-users:v1", 5 * 60_000, async () => {
      const res = await KontaktOsobe.findAll({ limit: 500 });
      const users: MentionableUser[] = (res.records as any[])
        .filter((u) => u.aktivan !== false && u.imeIPrezime)
        .map((u) => ({ id: u.id as string, imeIPrezime: String(u.imeIPrezime) }));
      users.sort((a, b) => a.imeIPrezime.localeCompare(b.imeIPrezime, "sr"));
      return { users };
    });
  }
);
