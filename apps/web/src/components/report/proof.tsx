import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { placeLabel, type Report, type ReportIndex } from "@/lib/report";
import { discussing, tooFew } from "@/lib/proof";
import { cn } from "@/lib/utils";
import { Section } from "./section";
import { Term, TERMS } from "./term";

type ClaimProof = NonNullable<Report["proof"]>["claims"][number];
type Rate = NonNullable<ClaimProof["contradiction"]>;

const VERDICT: Record<ClaimProof["verdict"], { label: string; variant: BadgeVariant; help: string }> = {
  contested: { label: "Contested", variant: "missing", help: TERMS.contested },
  backed: { label: "Backed", variant: "answered", help: TERMS.backed },
  not_enough_evidence: { label: "Not enough evidence", variant: "na", help: TERMS.notEnough },
};
const ORDER: ClaimProof["verdict"][] = ["contested", "backed", "not_enough_evidence"];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const interval = (r: Rate) => `${pct(r.low)} to ${pct(r.high)}`;

/** Of the reviews that discuss the claim: how many contradict it, are mixed, or back it, with the likely range of the contradiction share. */
function ShareBar({ c, rate }: { c: ClaimProof; rate: Rate }) {
  const total = discussing(c) || 1;
  const backing = (c.counts.supports / total) * 100;
  return (
    <div className="mt-4 max-w-xl" aria-hidden="true">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        {/* The likely range first, then the measured share on top of it. */}
        <span className="absolute inset-y-0 rounded-full bg-missing-fill/35" style={{ left: `${rate.low * 100}%`, width: `${(rate.high - rate.low) * 100}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-missing-fill" style={{ width: `${rate.rate * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
        <span className="text-missing">
          <span className="font-semibold">{pct(rate.rate)} contradict</span> <span className="text-muted-foreground">(likely {interval(rate)})</span>
        </span>
        <span className="text-answered">{pct(backing / 100)} back it</span>
      </div>
    </div>
  );
}

function Quote({ text, tone }: { text: string; tone: "for" | "against" }) {
  const Icon = tone === "for" ? CheckIcon : XIcon;
  return (
    <li className="flex gap-2.5 rounded-lg bg-muted/60 px-3 py-2 text-[13px] leading-snug">
      <span
        className={cn("mt-px flex size-4 shrink-0 items-center justify-center rounded-full", tone === "for" ? "bg-answered-bg text-answered" : "bg-missing-bg text-missing")}
        aria-hidden="true"
      >
        <Icon className="size-2.5" strokeWidth={3} />
      </span>
      <span className="min-w-0">{text}</span>
    </li>
  );
}

function Examples({ c }: { c: ClaimProof }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const sides = [
    { title: "Reviews that back it", items: c.examples.supports.slice(0, 2), tone: "for" as const },
    { title: "Reviews that contradict it", items: c.examples.contradicts.slice(0, 2), tone: "against" as const },
  ].filter((s) => s.items.length > 0);
  if (sides.length === 0) return null;
  const more = sides.reduce((n, s) => n + s.items.length - 1, 0);

  return (
    <div className="mt-4">
      <div className="grid gap-3 md:grid-cols-2">
        {sides.map((s) => (
          <div key={s.title}>
            <p className="text-xs font-semibold text-muted-foreground">{s.title}</p>
            <ul className="mt-1.5 grid gap-1.5">
              <Quote text={s.items[0]!} tone={s.tone} />
            </ul>
            <div className="collapse-grid" data-open={open} id={`${id}-${s.tone}`}>
              <div inert={!open}>
                <ul className="grid gap-1.5 pt-1.5">
                  {s.items.slice(1).map((t, i) => (
                    <Quote key={i} text={t} tone={s.tone} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
      {more > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={sides.map((s) => `${id}-${s.tone}`).join(" ")}
          onClick={() => setOpen((o) => !o)}
          className="mt-2 inline-flex items-center gap-1 rounded-sm text-[13px] font-semibold text-muted-foreground hover:text-foreground"
        >
          {open ? "Fewer reviews" : `${more} more ${more === 1 ? "review" : "reviews"}`}
          <ChevronDownIcon className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function ClaimCard({ c, index, topics }: { c: ClaimProof; index: ReportIndex; topics: boolean }) {
  const v = VERDICT[c.verdict];
  const total = discussing(c);
  // A claim can quote two phrases from one field; name each place once.
  const places = c.sources.filter((s, i, all) => all.findIndex((x) => x.kind === s.kind && x.id === s.id) === i);
  return (
    <li className="rounded-2xl border bg-card p-5 shadow-card sm:p-6" data-testid="proof-claim" data-intent={c.intentId} data-verdict={c.verdict}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Term help={v.help} className="no-underline">
          <Badge variant={v.variant}>{v.label}</Badge>
        </Term>
        <span className="text-[13px] text-muted-foreground">{index.intents.get(c.intentId)?.question ?? c.intentId}</span>
      </div>
      <p className="mt-2.5 text-lg leading-snug font-bold tracking-[-0.01em]">“{c.claim}”</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Said in{" "}
        {places.map((s, i) => (
          <span key={`${s.kind}:${s.id}`} title={s.id}>
            {i > 0 && ", "}
            {s.kind === "image"
              ? s.id
                  .split(",")
                  .map((id) => placeLabel(id.startsWith("img.") ? id : `img.${id}`))
                  .join(", ")
              : placeLabel(s.id)}
          </span>
        ))}
      </p>

      {c.verdict === "not_enough_evidence" || !c.contradiction ? (
        <p className="mt-4 text-sm" data-testid="proof-too-few">
          {topics ? `Only ${discussing(c).toLocaleString()} reviews mention "${c.keywords[0]}" for better or worse, too few to judge.` : tooFew(c)}
        </p>
      ) : (
        <>
          <ShareBar c={c} rate={c.contradiction} />
          <p className="mt-3 text-sm">
            <span className="font-semibold tabular-nums">
              {c.counts.contradicts.toLocaleString()} of {total.toLocaleString()}
            </span>{" "}
            {topics ? `review mentions of "${c.keywords[0]}" are negative` : "reviews that discuss it contradict it"}{" "}
            <span className="text-muted-foreground">
              ({pct(c.contradiction.rate)}, likely {interval(c.contradiction)})
            </span>
            {c.support && <span className="text-muted-foreground">; {c.counts.supports} back it up</span>}.
          </p>
        </>
      )}
      {!topics && c.sampled < c.matching && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          A random sample of {c.sampled} from the {c.matching} reviews that mention it.
        </p>
      )}

      <Examples c={c} />
    </li>
  );
}

export function PromiseVsProof({ report, index }: { report: Report; index: ReportIndex }) {
  const proof = report.proof;

  if (!proof) return null;

  const claims = [...proof.claims].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  return (
    <Section id="proof" title="Promise vs proof">
      {claims.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">The listing makes no claims that reviews could test.</p>
      ) : (
        <ul className="grid gap-3">
          {claims.map((c) => (
            <ClaimCard key={c.intentId} c={c} index={index} topics={proof.source === "amazon-topics"} />
          ))}
        </ul>
      )}
    </Section>
  );
}
