import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingOverlayProps {
  show: boolean;
  label?: string;
  className?: string;
}

/**
 * Apsolutno pozicioniran overlay sa spinnerom — postavi roditelju `relative`.
 */
export function LoadingOverlay({ show, label, className }: LoadingOverlayProps) {
  if (!show) return null;
  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-[inherit]",
        className,
      )}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label || "Učitavanje..."}
      </div>
    </div>
  );
}

export default LoadingOverlay;
