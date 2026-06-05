import * as React from "react";
import { CalendarIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Touch-friendly datetime picker.
 * - Trigger: full-width input-like button.
 * - Popover content: shadcn Calendar + two scroll wheels (sati / minuti).
 * - Value: empty string OR local-time ISO-like "YYYY-MM-DDTHH:mm" (kompatibilno sa `new Date(...)`).
 */
export interface TouchDateTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minuteStep?: number;
  className?: string;
  id?: string;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function parseValue(value: string): { date: Date | undefined; hour: number; minute: number } {
  if (!value) return { date: undefined, hour: new Date().getHours(), minute: 0 };
  // Treat as local datetime
  const d = new Date(value);
  if (isNaN(d.getTime())) return { date: undefined, hour: new Date().getHours(), minute: 0 };
  return { date: d, hour: d.getHours(), minute: d.getMinutes() };
}

function formatValue(date: Date, hour: number, minute: number): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${y}-${m}-${day}T${pad(hour)}:${pad(minute)}`;
}

function formatDisplay(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ITEM_HEIGHT = 44;

function WheelColumn({
  items,
  value,
  onChange,
  label,
}: {
  items: number[];
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const scrollTimeout = React.useRef<number | null>(null);
  const wheelAccum = React.useRef(0);
  const isUserScrolling = React.useRef(false);

  // Scroll to current value when opened or value changes externally (only when not actively scrolling)
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isUserScrolling.current) return;
    const idx = items.indexOf(value);
    if (idx < 0) return;
    el.scrollTo({ top: idx * ITEM_HEIGHT, behavior: "auto" });
  }, [value, items]);

  const handleScroll = () => {
    isUserScrolling.current = true;
    if (scrollTimeout.current) window.clearTimeout(scrollTimeout.current);
    scrollTimeout.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) { isUserScrolling.current = false; return; }
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      const next = items[clamped];
      el.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "smooth" });
      isUserScrolling.current = false;
      if (next !== value) onChange(next);
    }, 120);
  };

  // Native wheel handler: lets desktop mouse/trackpad scroll the column
  // smoothly without bubbling to the page.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      wheelAccum.current += e.deltaY;
      const threshold = 20;
      const steps = Math.trunc(wheelAccum.current / threshold);
      if (steps === 0) return;
      wheelAccum.current -= steps * threshold;
      const curIdx = items.indexOf(value);
      const base = curIdx < 0 ? 0 : curIdx;
      const nextIdx = Math.max(0, Math.min(items.length - 1, base + steps));
      const next = items[nextIdx];
      isUserScrolling.current = true;
      el.scrollTo({ top: nextIdx * ITEM_HEIGHT, behavior: "smooth" });
      window.setTimeout(() => { isUserScrolling.current = false; }, 200);
      if (next !== value) onChange(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [items, value, onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const curIdx = items.indexOf(value);
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const base = curIdx < 0 ? 0 : curIdx;
    const nextIdx = Math.max(0, Math.min(items.length - 1, base + delta));
    const next = items[nextIdx];
    ref.current?.scrollTo({ top: nextIdx * ITEM_HEIGHT, behavior: "smooth" });
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex flex-col items-center">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="relative">
        {/* Selection highlight */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-11 rounded-md border border-primary/40 bg-primary/10"
          aria-hidden
        />
        <div
          ref={ref}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="listbox"
          aria-label={label}
          className="h-[176px] w-16 overflow-y-auto snap-y snap-mandatory overscroll-contain outline-none [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" } as React.CSSProperties}
        >
          {/* top padding so first item can center */}
          <div style={{ height: ITEM_HEIGHT * 1.5 }} />
          {items.map((it) => (
            <div
              key={it}
              className={cn(
                "flex items-center justify-center snap-center text-lg select-none cursor-pointer",
                it === value ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
              style={{ height: ITEM_HEIGHT }}
              onClick={() => {
                const el = ref.current;
                if (el) el.scrollTo({ top: items.indexOf(it) * ITEM_HEIGHT, behavior: "smooth" });
                if (it !== value) onChange(it);
              }}
            >
              {pad(it)}
            </div>
          ))}
          <div style={{ height: ITEM_HEIGHT * 1.5 }} />
        </div>
      </div>
    </div>
  );
}

export function TouchDateTimePicker({
  value,
  onChange,
  placeholder = "Izaberite datum i vreme",
  minuteStep = 1,
  className,
  id,
}: TouchDateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const parsed = React.useMemo(() => parseValue(value), [value]);
  const [date, setDate] = React.useState<Date | undefined>(parsed.date);
  const [hour, setHour] = React.useState<number>(parsed.hour);
  const [minute, setMinute] = React.useState<number>(parsed.minute);

  // Sync when external value changes
  React.useEffect(() => {
    const p = parseValue(value);
    setDate(p.date);
    setHour(p.hour);
    setMinute(p.minute);
  }, [value]);

  const hours = React.useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = React.useMemo(() => {
    const step = Math.max(1, minuteStep);
    return Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  }, [minuteStep]);

  const confirm = () => {
    const d = date ?? new Date();
    onChange(formatValue(d, hour, minute));
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const display = formatDisplay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={cn(
            "flex h-12 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-base text-left",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !display && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <CalendarIcon className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{display || placeholder}</span>
          </span>
          {display && (
            <span
              role="button"
              tabIndex={-1}
              onClick={clear}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Obriši"
            >
              <X className="size-4" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => d && setDate(d)}
            initialFocus
          />
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-end gap-2">
              <WheelColumn items={hours} value={hour} onChange={setHour} label="Sati" />
              <div className="text-2xl font-semibold pb-1">:</div>
              <WheelColumn items={minutes} value={minute} onChange={setMinute} label="Min" />
            </div>
            <div className="text-sm text-muted-foreground">
              {date ? date.toLocaleDateString("sr-RS") : "—"} {pad(hour)}:{pad(minute)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const now = new Date();
              setDate(now);
              setHour(now.getHours());
              setMinute(now.getMinutes() - (now.getMinutes() % Math.max(1, minuteStep)));
            }}
          >
            Sada
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Otkaži
            </Button>
            <Button type="button" size="sm" onClick={confirm} disabled={!date}>
              Potvrdi
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
