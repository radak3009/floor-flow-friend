import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AsyncButtonProps extends ButtonProps {
  pending?: boolean;
  pendingLabel?: React.ReactNode;
}

/**
 * Dugme koje prikazuje spinner i sprečava duple klikove dok je `pending`.
 * Koristi se za sve akcije koje pokreću mutaciju (start/pauza/stop/scrap...).
 */
export const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ pending = false, pendingLabel, disabled, children, className, ...rest }, ref) => {
    return (
      <Button
        ref={ref}
        disabled={pending || disabled}
        className={cn(className)}
        {...rest}
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <span className="inline-flex items-center gap-2">
          {pending && pendingLabel ? pendingLabel : children}
        </span>
      </Button>
    );
  },
);
AsyncButton.displayName = "AsyncButton";

export default AsyncButton;
