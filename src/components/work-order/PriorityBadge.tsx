import { cn } from "@/lib/utils";

// Colors mapped from Airtable single-select options of field "Prioritet" (fldSHYcMuDNzy6tef)
// Visok → orangeBright, Normalan → greenLight1, Nizak → blueLight2
const COLORS: Record<string, string> = {
  "Visok": "bg-orange-500 text-white",
  "Normalan": "bg-green-200 text-green-900",
  "Nizak": "bg-blue-200 text-blue-900",
};

export interface PriorityBadgeProps {
  value?: string | null;
  className?: string;
}

export function PriorityBadge({ value, className }: PriorityBadgeProps) {
  if (!value) return null;
  const cls = COLORS[value] ?? "bg-muted text-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        cls,
        className,
      )}
      title={`Prioritet: ${value}`}
    >
      {value}
    </span>
  );
}

export default PriorityBadge;
