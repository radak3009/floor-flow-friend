import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { useOutboxOps } from "@/hooks/useOutbox";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { flushOutbox, retryOp, removeOp, type OutboxOp } from "@/lib/offline/outbox";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export default function OutboxDrawer({ open, onOpenChange }: Props) {
  const ops = useOutboxOps();
  const online = useOnlineStatus();
  const [busy, setBusy] = useState(false);

  async function handleFlush() {
    setBusy(true);
    try { await flushOutbox(); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>Stavke na čekanju</SheetTitle>
        </SheetHeader>

        <div className="text-xs text-muted-foreground mt-1">
          {online
            ? "Online — stavke se automatski šalju serveru."
            : "Offline — stavke će biti poslate kad se konekcija vrati."}
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-3">
          {ops.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground gap-2">
              <CheckCircle2 className="size-8 text-emerald-500" />
              <span>Nema stavki na čekanju</span>
            </div>
          ) : (
            <ul className="space-y-2">
              {ops.map((op) => (
                <OutboxItem key={op.id} op={op} />
              ))}
            </ul>
          )}
        </div>

        {ops.length > 0 && (
          <div className="border-t border-border pt-3 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Zatvori</Button>
            <Button onClick={handleFlush} disabled={busy || !online} className="min-w-32">
              <RefreshCw className={`size-4 mr-2 ${busy ? "animate-spin" : ""}`} />
              Pokušaj ponovo
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function OutboxItem({ op }: { op: OutboxOp }) {
  const isFailed = op.status === "failed";
  const isRunning = op.status === "running";
  return (
    <li className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{op.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {new Date(op.createdAt).toLocaleString("sr-RS")}
            {op.attempts > 0 && ` · pokušaja: ${op.attempts}`}
          </div>
          {op.lastError && (
            <div className="text-xs text-destructive mt-1 flex items-start gap-1">
              <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
              <span className="break-words">{op.lastError}</span>
            </div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1">
          {isRunning ? (
            <RefreshCw className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Clock className="size-4 text-muted-foreground" />
          )}
        </div>
      </div>
      {(isFailed || op.attempts > 0) && (
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => retryOp(op.id)}>
            <RefreshCw className="size-3.5 mr-1" /> Pokušaj
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => removeOp(op.id)}>
            <X className="size-3.5 mr-1" /> Ukloni
          </Button>
        </div>
      )}
    </li>
  );
}
