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
    <aside aria-labelledby="why-title" className="self-start rounded-xl bg-tint p-6 sm:p-8">
      <h2 id="why-title" className="text-sm font-semibold text-[#9a3412]">
        Why this exists
      </h2>
      <figure className="mt-4">
        <blockquote className="border-l-[3px] border-primary pl-4 text-[21px] leading-snug font-semibold">
          <p>“Alexa recommendation visibility is not currently available as a standalone metric in Seller Central.”</p>
        </blockquote>
        <figcaption className="mt-4 pl-[19px]">
          <BlogSource />
        </figcaption>
      </figure>
      <p className="mt-6 border-t border-[#fbd9b0] pt-5 text-[17px] font-semibold">This doesn't measure Alexa. It measures what Alexa reads.</p>
      <p className="mt-2 text-sm text-[#5c4a3a]">
        The listing's title, bullets, description, A+ text and attributes. If the page never states a fact, Alexa can't use it to answer a shopper.
      </p>
    </aside>
  );
}
