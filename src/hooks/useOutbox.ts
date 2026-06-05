import { useSyncExternalStore } from "react";
import { subscribeOutbox, getOutboxOps, type OutboxOp } from "@/lib/offline/outbox";

export function useOutboxOps(): OutboxOp[] {
  return useSyncExternalStore(
    subscribeOutbox,
    () => getOutboxOps(),
    () => [] as OutboxOp[],
  );
}

export function useOutboxPendingCount(): number {
  const ops = useOutboxOps();
  return ops.length;
}
