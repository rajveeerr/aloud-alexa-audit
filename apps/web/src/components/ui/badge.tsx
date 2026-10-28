import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold [&_svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-muted text-foreground",
      outline: "border-input text-muted-foreground",
      warn: "border-[#fcd9a8] bg-tint text-[#9a3412]",
      answered: "border-transparent bg-answered-bg text-answered",
      partial: "border-transparent bg-partial-bg text-partial",
      missing: "border-transparent bg-missing-bg text-missing",
      contradicted: "border-transparent bg-contradicted-bg text-contradicted",
      na: "border-transparent bg-na-bg text-na",
    },
  },
  defaultVariants: { variant: "default" },
});

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
