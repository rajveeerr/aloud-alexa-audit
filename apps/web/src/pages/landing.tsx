import { Page } from "@/components/app-shell";
import { AuditForm } from "@/components/audit-form";
import { WhyThisExists } from "@/components/why-this-exists";

const CHECKS = [
  {
    name: "Hidden answers",
    body: "Claims the brand already makes, but only inside images. Alexa may never read them. The fix is to move the brand's own words into text.",
  },
  {
    name: "Unanswered questions",
    body: "The questions shoppers ask, mined from reviews with counts, that the listing doesn't answer in text, and whether competitors do.",
  },
  {
    name: "Promise vs proof",
    body: "Listing claims checked against the product's own reviews: how many of the reviews that discuss a claim back it or contradict it.",
  },
];

export function LandingPage() {
  return (
    <Page className="pt-10 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
        <section aria-labelledby="hero-title">
          <h1 id="hero-title" className="max-w-[18ch] text-[34px] leading-[1.08] font-bold sm:text-[44px]">
            What can Alexa say about your product?
          </h1>
          <p className="mt-4 max-w-[58ch] text-[17px] leading-relaxed text-muted-foreground">
            Enter an ASIN. answerable checks which shopper questions the listing answers in readable text, quotes the exact words for every answer,
            and ranks the fixes.
          </p>
          <div className="mt-8">
            <AuditForm />
          </div>
        </section>
        <WhyThisExists />
      </div>

      <section aria-labelledby="checks-title" className="mt-16 border-t pt-10">
        <h2 id="checks-title" className="text-xl font-bold">
          Three checks, each from SalesDuo's own advice
        </h2>
        <div className="mt-6 grid gap-8 sm:grid-cols-3">
          {CHECKS.map((c) => (
            <div key={c.name}>
              <h3 className="flex items-center gap-2 text-base font-semibold">
                {c.name}
              </h3>
              <p className="mt-2 text-[15px] text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
