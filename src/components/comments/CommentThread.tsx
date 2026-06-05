import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listCommentsFn,
  postCommentFn,
  deleteCommentFn,
  listMentionableUsersFn,
  type CommentRow,
  type MentionableUser,
} from "@/lib/api/comments.functions";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

const MENTION_RX = /@\[([^\]]+)\]\((rec[a-zA-Z0-9]+)\)/g;

function renderBody(body: string) {
  const parts: Array<{ kind: "text" | "mention"; value: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const rx = new RegExp(MENTION_RX.source, "g");
  while ((m = rx.exec(body)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: body.slice(last, m.index) });
    parts.push({ kind: "mention", value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", value: body.slice(last) });
  return parts.map((p, i) =>
    p.kind === "mention" ? (
      <span key={i} className="text-primary font-medium">@{p.value}</span>
    ) : (
      <span key={i}>{p.value}</span>
    )
  );
}

function fmtTime(s: string) {
  try {
    const d = new Date(s);
    return d.toLocaleString("sr-RS", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s;
  }
}

export default function CommentThread({
  entityType,
  entityId,
  entityLabel,
}: {
  entityType: "work_order";
  entityId: string;
  entityLabel: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const callList = useServerFn(listCommentsFn);
  const callPost = useServerFn(postCommentFn);
  const callDelete = useServerFn(deleteCommentFn);
  const callUsers = useServerFn(listMentionableUsersFn);

  const queryKey = ["comments", entityType, entityId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => callList({ data: { entityType, entityId } }),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const usersQ = useQuery({
    queryKey: ["mentionable-users"],
    queryFn: () => callUsers(),
    staleTime: 5 * 60_000,
  });

  // Note: realtime subscription removed for security (comments table is no longer
  // exposed via Supabase Realtime). The query above polls via refetchInterval below.

  const items = data?.items || [];

  const postM = useMutation({
    mutationFn: callPost,
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const delM = useMutation({
    mutationFn: callDelete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const [body, setBody] = useState("");
  const [pendingMentions, setPendingMentions] = useState<Array<{ name: string; id: string }>>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Mention autocomplete state
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const filteredUsers = useMemo<MentionableUser[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return (usersQ.data?.users || [])
      .filter((u) => u.imeIPrezime.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, usersQ.data]);

  function onBodyChange(v: string) {
    setBody(v);
    // drop tracked mentions whose @Name no longer appears in the body
    setPendingMentions((prev) => prev.filter((pm) => v.includes(`@${pm.name}`)));
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart ?? v.length;
    // find @ token before caret (no whitespace, not already a completed token)
    const upto = v.slice(0, caret);
    const m = /(^|\s)@([\wšđčćžŠĐČĆŽ.\- ]{0,30})$/.exec(upto);
    if (m) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
    } else {
      setMention(null);
    }
  }

  function insertMention(u: MentionableUser) {
    if (!mention) return;
    const before = body.slice(0, mention.start);
    const after = body.slice((taRef.current?.selectionStart ?? body.length));
    const token = `@${u.imeIPrezime} `;
    const next = before + token + after;
    setBody(next);
    setPendingMentions((prev) => [...prev, { name: u.imeIPrezime, id: u.id }]);
    setMention(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        const pos = (before + token).length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  function buildBodyWithTokens(): string {
    let out = body.trim();
    // replace first occurrence of each tracked @Name with the full token in order
    for (const pm of pendingMentions) {
      const needle = `@${pm.name}`;
      const idx = out.indexOf(needle);
      if (idx === -1) continue;
      const replacement = `@[${pm.name}](${pm.id})`;
      out = out.slice(0, idx) + replacement + out.slice(idx + needle.length);
    }
    return out;
  }

  function submit() {
    if (!user || !body.trim() || postM.isPending) return;
    postM.mutate({
      data: {
        entityType,
        entityId,
        entityLabel,
        authorId: user.id,
        authorName: user.imeIPrezime,
        body: buildBodyWithTokens(),
      },
    });
    setPendingMentions([]);
  }


  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
        {isLoading && <div className="text-sm text-muted-foreground p-4 text-center">Učitavanje...</div>}
        {!isLoading && items.length === 0 && (
          <div className="text-sm text-muted-foreground p-6 text-center border border-dashed rounded-lg">
            Još nema komentara. Pomenite kolegu sa @ da mu pošaljete obaveštenje.
          </div>
        )}
        {items.map((c: CommentRow) => {
          const isMine = c.authorId === user?.id;
          return (
            <div key={c.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="font-medium truncate">{c.authorName}</div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{fmtTime(c.createdAt)}</span>
                  {isMine && (
                    <button
                      onClick={() => delM.mutate({ data: { commentId: c.id, authorId: user!.id } })}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Obriši"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="whitespace-pre-wrap break-words leading-relaxed">{renderBody(c.body)}</div>
            </div>
          );
        })}
      </div>

      <div className="relative">
        <Textarea
          ref={taRef}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          placeholder="Napišite komentar. Koristite @ da pomenete kolegu."
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {mention && filteredUsers.length > 0 && (
          <div className="absolute left-0 right-0 bottom-full mb-1 z-50 rounded-md border border-border bg-popover shadow-md max-h-56 overflow-y-auto">
            {filteredUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="text-primary">@</span>
                {u.imeIPrezime}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">Ctrl/⌘ + Enter za slanje</span>
          <Button size="sm" onClick={submit} disabled={!body.trim() || postM.isPending}>
            <Send className="size-4 mr-2" /> Pošalji
          </Button>
        </div>
      </div>
    </div>
  );
}
