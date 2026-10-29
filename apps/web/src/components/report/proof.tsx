import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { fieldLabel, type Report, type ReportIndex } from "@/lib/report";
import { cn, plural } from "@/lib/utils";
import { Section } from "./section";

type ClaimProof = NonNullable<Report["proof"]>["claims"][number];
type Rate = NonNullable<ClaimProof["contradiction"]>;

const VERDICT: Record<ClaimProof["verdict"], { label: string; variant: BadgeVariant }> = {
  contested: { label: "Contested", variant: "missing" },
  backed: { label: "Backed", variant: "answered" },
  not_enough_evidence: { label: "Not enough evidence", variant: "na" },
};
const ORDER: ClaimProof["verdict"][] = ["contested", "backed", "not_enough_evidence"];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const interval = (r: Rate) => `${pct(r.low)} to ${pct(r.high)}`;

/** Reviews that actually discuss the claim: the base every rate is a share of. */
const discussing = (c: ClaimProof) => c.counts.supports + c.counts.contradicts + c.counts.mixed;

function Examples({ title, items, tone }: { title: string; items: string[]; tone: "for" | "against" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <ul className="mt-1 grid gap-1.5">
        {items.slice(0, 2).map((t) => (
          <li
            key={t}
            className={cn("rounded-md border-l-2 bg-muted/60 px-3 py-1.5 text-[13px] leading-snug", tone === "for" ? "border-answered" : "border-missing")}
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClaimCard({ c, index }: { c: ClaimProof; index: ReportIndex }) {
  const v = VERDICT[c.verdict];
  const total = discussing(c);
  return (
    <li className="rounded-xl border p-4 sm:p-5" data-testid="proof-claim" data-intent={c.intentId} data-verdict={c.verdict}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={v.variant}>{v.label}</Badge>
        <span className="text-[13px] text-muted-foreground">{index.intents.get(c.intentId)?.question ?? c.intentId}</span>
      </div>
      <p className="mt-2 text-[17px] leading-snug font-semibold">“{c.claim}”</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Said in{" "}
        {c.sources.map((s, i) => (
          <span key={s.kind + s.id}>
            {i > 0 && ", "}
            {s.kind === "image" ? "image " : `${fieldLabel(s.id)} `}
            <span className="font-mono text-xs">({s.id})</span>
          </span>
        ))}
      </p>

      {c.verdict === "not_enough_evidence" || !c.contradiction ? (
        <p className="mt-3 text-sm">
          Only {plural(c.matching, "review")} {c.matching === 1 ? "mentions" : "mention"} it, too few to say either way.
        </p>
      ) : (
        <p className="mt-3 text-sm">
          <span className="font-semibold tabular-nums">
            {c.counts.contradicts} of {total}
          </span>{" "}
          reviews that discuss it contradict it{" "}
          <span className="text-muted-foreground">
            ({pct(c.contradiction.rate)}, likely {interval(c.contradiction)})
          </span>
          {c.support && (
            <span className="text-muted-foreground">
              ; {c.counts.supports} back it up
            </span>
          )}
          .
        </p>
      )}
      {c.sampled < c.matching && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          A random sample of {c.sampled} from the {c.matching} reviews that mention it.
        </p>
      )}

      {(c.examples.supports.length > 0 || c.examples.contradicts.length > 0) && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Examples title="Reviews that back it" items={c.examples.supports} tone="for" />
          <Examples title="Reviews that contradict it" items={c.examples.contradicts} tone="against" />
        </div>
      )}
    </li>
  );
}

export function PromiseVsProof({ report, index }: { report: Report; index: ReportIndex }) {
  const proof = report.proof;
  const note = report.notes.find((n) => /promise vs proof/i.test(n));

  if (!proof) {
    return (
      <Section id="proof" title="Promise vs proof" description="The listing's own claims, checked against what this product's reviews say.">
        <p className="text-[15px] text-muted-foreground" data-testid="proof-absent">
          {note ?? "Promise vs proof wasn't checked for this audit."}
        </p>
      </Section>
    );
  }

  const claims = [...proof.claims].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
  return (
    <Section
      id="proof"
      title="Promise vs proof"
      description={
        <>
          The listing's own claims, checked against {proof.reviews.toLocaleString()} reviews of this product. Rates are shares of the reviews that
          discuss each claim, not of all buyers, and the range is a 95% interval.
        </>
      }
    >
      {claims.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">The listing makes no claims that reviews could test.</p>
      ) : (
        <ul className="grid gap-3">
          {claims.map((c) => (
            <ClaimCard key={c.intentId} c={c} index={index} />
          ))}
        </ul>
      )}
    </Section>
  );
}
