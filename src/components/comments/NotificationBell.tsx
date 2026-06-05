import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listMyNotificationsFn,
  markNotificationsReadFn,
  type NotificationRow,
} from "@/lib/api/comments.functions";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "@tanstack/react-router";

function fmtTime(s: string) {
  try {
    const d = new Date(s);
    const now = Date.now();
    const diffMin = Math.round((now - d.getTime()) / 60000);
    if (diffMin < 1) return "sada";
    if (diffMin < 60) return `pre ${diffMin} min`;
    if (diffMin < 60 * 24) return `pre ${Math.round(diffMin / 60)}h`;
    return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit" });
  } catch {
    return s;
  }
}

export default function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const callList = useServerFn(listMyNotificationsFn);
  const callMark = useServerFn(markNotificationsReadFn);

  const queryKey = ["notifications", user?.id];
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey,
    queryFn: () => callList({ data: { userId: user!.id, limit: 60 } }),
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });

  const markM = useMutation({
    mutationFn: callMark,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (!user) return null;
  const items = data?.items || [];
  const unreadItems = items.filter((n) => !n.readAt);
  const readItems = items.filter((n) => !!n.readAt);
  const unread = unreadItems.length;

  function handleClick(n: NotificationRow) {
    if (!n.readAt) {
      markM.mutate({ data: { userId: user!.id, notificationId: n.id } });
    }
    setOpen(false);
    if (n.entityType === "work_order" && n.entityId) {
      navigate({ to: "/monitoring", search: { wo: n.entityId, tab: "chat" } });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative min-h-11 min-w-11" aria-label="Notifikacije">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <div className="font-semibold text-sm">Notifikacije</div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => markM.mutate({ data: { userId: user.id, all: true } })}
            >
              <CheckCheck className="size-3.5 mr-1" /> Pročitaj sve
            </Button>
          )}
        </div>
        <Tabs defaultValue="unread">
          <TabsList className="grid grid-cols-2 w-full rounded-none border-b border-border bg-transparent h-9">
            <TabsTrigger value="unread" className="text-xs">
              Nepročitane{unread > 0 ? ` (${unread})` : ""}
            </TabsTrigger>
            <TabsTrigger value="read" className="text-xs">
              Pročitane
            </TabsTrigger>
          </TabsList>
          <TabsContent value="unread" className="m-0">
            <NotificationList items={unreadItems} onClick={handleClick} emptyText="Nema novih notifikacija" />
          </TabsContent>
          <TabsContent value="read" className="m-0">
            <NotificationList items={readItems} onClick={handleClick} emptyText="Nema pročitanih notifikacija" />
            {readItems.length > 0 && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground border-t border-border text-center">
                Pročitane notifikacije se automatski brišu posle 30 dana.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  items, onClick, emptyText,
}: {
  items: NotificationRow[];
  onClick: (n: NotificationRow) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="p-6 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <div className="max-h-96 overflow-y-auto">
      {items.map((n) => (
        <button
          key={n.id}
          onClick={() => onClick(n)}
          className={`w-full text-left p-3 border-b border-border hover:bg-accent transition ${!n.readAt ? "bg-accent/30" : ""}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-medium leading-tight">{n.title}</div>
            {!n.readAt && <span className="size-2 rounded-full bg-primary shrink-0 mt-1.5" />}
          </div>
          {n.body && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
          )}
          <div className="text-[10px] text-muted-foreground mt-1">{fmtTime(n.createdAt)}</div>
        </button>
      ))}
    </div>
  );
}
