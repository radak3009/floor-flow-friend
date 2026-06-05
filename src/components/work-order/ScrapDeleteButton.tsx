import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { deleteScrapEntryFn } from "@/lib/api/workorder.functions";
import { invalidateAfterActionDelayed, patchWoHistoryRemove, rollback } from "@/lib/query/invalidate";

export default function ScrapDeleteButton({
  promenaId,
  userId,
  radniNalogId,
}: {
  promenaId: string;
  userId: string;
  radniNalogId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [razlog, setRazlog] = useState("");
  const queryClient = useQueryClient();
  const callDelete = useServerFn(deleteScrapEntryFn);

  const m = useMutation({
    mutationFn: () => callDelete({ data: { promenaId, userId, razlog: razlog.trim() } }),
    onMutate: async () => {
      const woSnap = await patchWoHistoryRemove(queryClient, radniNalogId, promenaId);
      return { woSnap };
    },
    onSuccess: () => {
      toast.success("Škart obrisan");
      setOpen(false);
      setRazlog("");
    },
    onError: (e: Error, _v, ctx) => {
      rollback(queryClient, ctx?.woSnap);
      toast.error(e.message || "Brisanje nije uspelo");
    },
    onSettled: () => invalidateAfterActionDelayed(queryClient, { radniNalogId }),
  });

  const valid = razlog.trim().length >= 3;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground hover:text-destructive"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Obriši škart"
      >
        <X className="size-4" />
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => { if (!m.isPending) setOpen(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Brisanje škart zapisa</AlertDialogTitle>
            <AlertDialogDescription>
              Da li sigurno želite da obrišete ovaj škart? Unesite razlog brisanja (min. 3 karaktera).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="razlog-brisanja">Razlog brisanja</Label>
            <Textarea
              id="razlog-brisanja"
              rows={3}
              value={razlog}
              onChange={(e) => setRazlog(e.target.value)}
              placeholder="Npr. duplo evidentiran zapis"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={m.isPending}>Otkaži</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (valid) m.mutate(); }}
              disabled={!valid || m.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {m.isPending ? "Brisanje..." : "Obriši"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
