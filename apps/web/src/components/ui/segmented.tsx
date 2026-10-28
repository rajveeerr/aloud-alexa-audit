import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string };

/** A small radio group drawn as a segmented switch. Arrow keys move between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      orientation="horizontal"
      className={cn("inline-flex rounded-md bg-muted p-0.5", className)}
    >
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          className="h-8 rounded-[calc(var(--radius)-4px)] px-3 text-[13px] font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-[0_1px_2px_rgba(35,31,35,0.12)]"
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
