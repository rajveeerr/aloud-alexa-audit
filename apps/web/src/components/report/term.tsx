import type { ReactNode } from "react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A word the report uses in its own sense ("hidden answer", "contested"): dotted underline,
 * one-sentence definition on hover or keyboard focus.
 */
export function Term({ help, children, className }: { help: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tip content={help}>
      <button
        type="button"
        className={cn(
          "cursor-help rounded-[3px] text-left underline decoration-current/35 decoration-dotted decoration-[1.5px] underline-offset-[3px] hover:decoration-current/70",
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export const TERMS = {
  hidden: "An answer the brand gives only inside an image. Alexa reads the listing's text, so it may never use it.",
  gap: "A question this listing misses, half answers or contradicts. Ranked by how often shoppers ask and how many competitors answer it.",
  contested: "Even at the low end of the range, at least 1 in 20 reviewers who discuss the claim say the opposite.",
  backed: "Fewer than 1 in 20 reviewers who discuss the claim are likely to say the opposite.",
  notEnough: "Too few reviews discuss the claim to judge it either way.",
  interval: "The likely range for the true share, at 95% confidence. Fewer reviews give a wider range.",
} as const;
