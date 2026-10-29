import { BlogSource } from "@/components/why-this-exists";
import type { Report } from "@/lib/report";
import { Section } from "./section";

export function HowScored({ report }: { report: Report }) {
  const u = report.usage;
  return (
    <Section id="scoring" title="How this is scored">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid gap-4 text-[15px]">
          <p>
            The score is the share of shopper demand the listing answers in readable text. Each question is weighted by how many sampled reviews
            asked it:
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-[13px] leading-relaxed">
            {"score = 100 × Σ(frequency × weight) / Σ(frequency)\nweight: answered 1, partly 0.5, missing 0, contradicted 0"}
          </pre>
          <ul className="grid list-disc gap-1.5 pl-5 text-muted-foreground marker:text-border">
            <li>Only spec and claim questions count. How a product feels is for buyers to say, so those questions never count.</li>
            <li>Every answer needs a quote, and code checks each quote is really on the listing. An answer without one counts as missing.</li>
            <li>Claims inside images don't count, since Alexa may not read them. They show up as hidden answers instead.</li>
            <li>When no reviews were mined for a category, questions are estimated and every one weighs the same.</li>
          </ul>
          <p className="text-[13px] text-muted-foreground">
            This audit made {u.requests} model calls ({u.cachedRequests} from cache), {u.inputTokens.toLocaleString()} input and{" "}
            {u.outputTokens.toLocaleString()} output tokens.
          </p>
        </div>
        <div className="self-start rounded-xl bg-tint p-5 sm:p-6">
          <p className="text-[15px]">
            The checks follow SalesDuo's own guide: complete every attribute, answer the questions buyers ask, and put important claims in text
            Alexa can read.
          </p>
          <blockquote className="mt-4 border-l-[3px] border-primary pl-4 text-[17px] leading-snug font-semibold">
            <p>“Important claims should also appear in readable fields such as bullet points, descriptions, A+ module text…”</p>
          </blockquote>
          <BlogSource className="mt-3 pl-[19px]" />
        </div>
      </div>
    </Section>
  );
}

export function Notes({ report }: { report: Report }) {
  const notes = [...report.notes];
  if (report.skippedImageIds.length) notes.push(`The image reader refused ${report.skippedImageIds.join(", ")}, so claims in those images weren't checked.`);
  if (notes.length === 0) return null;
  return (
    <Section id="notes" title="Notes">
      <ul className="grid list-disc gap-1.5 pl-5 text-[15px] text-muted-foreground marker:text-border">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </Section>
  );
}
