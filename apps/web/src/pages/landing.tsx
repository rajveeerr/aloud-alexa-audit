import { ImageIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Page } from "@/components/app-shell";
import { AuditForm } from "@/components/audit-form";
import { LiveExample } from "@/components/live-example";
import { StatusIcon } from "@/components/report/status";
import { WhyThisExists } from "@/components/why-this-exists";

/** Each check with a small picture of what it finds, drawn with the report's own pieces. */
const CHECKS: { name: string; body: string; visual: ReactNode }[] = [
  {
    name: "Hidden answers",
    body: "Claims the brand already makes, but only inside images. Alexa may never read them. The fix is to move the brand's own words into text.",
    visual: (
      <div className="grid gap-1.5 text-[13px]">
        <span className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
          <ImageIcon className="size-3.5 text-[#9a3412]" aria-hidden="true" />
          <span className="text-muted-foreground">Image 8</span> “No Smear: Perfect for Left-Handed”
        </span>
        <span className="flex items-center gap-2 rounded-md bg-answered-bg px-2.5 py-1.5 text-[#14532d]">
          <PlusIcon className="size-3.5 text-answered" strokeWidth={2.75} aria-hidden="true" />
          <span className="text-answered">New bullet</span> “No Smear: Perfect for Left-Handed”
        </span>
      </div>
    ),
  },
  {
    name: "Unanswered questions",
    body: "The questions shoppers ask, mined from reviews with counts, that the listing doesn't answer in text, and whether competitors do.",
    visual: (
      <ul className="grid gap-1.5 text-[13px]">
        {(
          [
            ["missing", "How long does the ink last?", "108"],
            ["partial", "How heavy is the pen and how is it balanced?", "18"],
            ["answered", "What is the tip size or line width?", "130"],
          ] as const
        ).map(([s, q, n]) => (
          <li key={q} className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
            <StatusIcon status={s} className="size-[18px] [&_svg]:size-2.5" />
            <span className="min-w-0 flex-1 truncate">{q}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{n} ask</span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    name: "Promise vs proof",
    body: "Listing claims checked against the product's own reviews: how many of the reviews that discuss a claim back it or contradict it.",
    visual: (
      <div className="rounded-md bg-background px-2.5 py-2 text-[13px]">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">“no globs”</span>
          <span className="rounded-full bg-missing-bg px-2 py-px text-xs font-semibold text-missing">Contested</span>
        </span>
        <span className="relative mt-2 block h-2 overflow-hidden rounded-full bg-muted">
          <span className="absolute inset-y-0 left-[41%] w-[24%] rounded-full bg-missing-fill/35" />
          <span className="absolute inset-y-0 left-0 w-[53%] rounded-full bg-missing-fill" />
        </span>
        <span className="mt-1 block text-xs text-muted-foreground tabular-nums">33 of 62 reviews that discuss it contradict it</span>
      </div>
    ),
  },
];

export function LandingPage() {
  return (
    <Page className="pt-10 sm:pt-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start lg:gap-14">
        <section aria-labelledby="hero-title">
          <h1 id="hero-title" className="max-w-[16ch] text-[36px] leading-[1.05] font-bold tracking-[-0.025em] sm:text-[48px]">
            What can Alexa say about your product?
          </h1>
          <p className="mt-5 max-w-[54ch] text-[17px] leading-relaxed text-muted-foreground">
            Enter an ASIN. Aloud checks which shopper questions the listing answers in readable text, quotes the exact words for every answer,
            and ranks the fixes.
          </p>
          <div className="mt-8">
            <AuditForm />
          </div>
        </section>
        <LiveExample className="lg:mt-2" />
      </div>

      <div className="mt-16">
        <WhyThisExists />
      </div>

      <section aria-labelledby="checks-title" className="mt-16">
        <h2 id="checks-title" className="text-[22px] font-bold tracking-[-0.015em]">
          Three checks, each from SalesDuo's own advice
        </h2>
        <div className="mt-6 grid gap-x-8 gap-y-10 md:grid-cols-3">
          {CHECKS.map((c) => (
            <div key={c.name}>
              <div className="rounded-xl bg-muted/70 p-3" aria-hidden="true">
                {c.visual}
              </div>
              <h3 className="mt-4 text-base font-semibold">{c.name}</h3>
              <p className="mt-1.5 text-[15px] text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
