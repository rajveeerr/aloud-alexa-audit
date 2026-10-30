import { QuoteIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const BLOG = {
  url: "https://salesduo.com/blog/alexa-for-shopping-optimization/",
  title: "Alexa for Shopping Optimization 2026: The Complete Guide for Amazon Sellers",
  author: "Mamta Mathe",
  date: "June 18, 2026",
};

export function BlogSource({ className }: { className?: string }) {
  return (
    <p className={cn("text-[13px] leading-snug text-muted-foreground", className)}>
      <a href={BLOG.url} target="_blank" rel="noreferrer" className="font-semibold text-foreground underline decoration-border underline-offset-4 hover:decoration-primary">
        {BLOG.title}
      </a>
      , {BLOG.author}, salesduo.com, {BLOG.date}
    </p>
  );
}

export function WhyThisExists() {
  return (
    <aside aria-labelledby="why-title" className="grid gap-8 rounded-2xl bg-tint p-6 sm:p-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-12">
      <div>
        <h2 id="why-title" className="flex items-center gap-2 text-[13px] font-semibold text-[#9a3412]">
          <QuoteIcon className="size-4 fill-current" aria-hidden="true" />
          Why this exists
        </h2>
        <figure className="mt-3">
          <blockquote className="text-[22px] leading-snug font-semibold tracking-[-0.01em] sm:text-2xl">
            <p>“Alexa recommendation visibility is not currently available as a standalone metric in Seller Central.”</p>
          </blockquote>
          <figcaption className="mt-4">
            <BlogSource />
          </figcaption>
        </figure>
      </div>
      <div className="self-end border-t border-[#fbd9b0] pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
        <p className="text-[17px] leading-snug font-semibold">This doesn't measure Alexa. It measures what Alexa reads.</p>
        <p className="mt-2 text-sm text-[#5c4a3a]">
          The listing's title, bullets, description, A+ text and attributes. If the page never states a fact, Alexa can't use it to answer a shopper.
        </p>
      </div>
    </aside>
  );
}
