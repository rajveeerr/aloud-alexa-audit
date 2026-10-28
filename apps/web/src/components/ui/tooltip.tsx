import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

export function TooltipContent({ className, sideOffset = 6, children, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn("z-50 max-w-72 rounded-md bg-[#2f2f2d] px-3 py-2 text-[13px] leading-snug text-white shadow-md", className)}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-[#2f2f2d]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/** A tooltip on a focusable trigger, so keyboard users get it too. */
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent>{content}</TooltipContent>
    </TooltipPrimitive.Root>
  );
}
