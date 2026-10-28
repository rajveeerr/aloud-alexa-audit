# Fixtures

Recorded listings so development and tests never call paid or rate-limited
APIs. All are gel pens (Office Products > Gel Ink Rollerball Pens).

- `dataset/`: raw product records from Amazon Reviews 2023 (McAuley Lab,
  UCSD), data up to Sep 2023, research use.
- `serpapi/`: SerpApi `amazon_product` responses, fetched Oct 2026, with
  `search_metadata`, `search_parameters` and the sponsored/related product
  blocks removed.

| ASIN | Product | Source | Note |
|---|---|---|---|
| B09YP9YYZG | Pilot G2 | dataset | |
| B097CF46RC | Pentel EnerGel RTX | dataset, serpapi | live resolves to B018UJ2YWE |
| B0BSMKF5BQ | Sharpie S-Gel | dataset, serpapi | live resolves to a green variant; `color` and `ink_color` disagree |
| B0143LMAEK | Uni-ball Signo White | dataset | one bullet |
| B08CMWPFR1 | Scentco Glitter | dataset | no bullets, no description |
| B001GAOTSW | Pilot G2 | serpapi | |
| B0BGPYR8Q3 | BIC Gel-ocity | serpapi | live resolves to B0744D6P4V |
| B0C9W8DD9S | Ddaowanx Gel Pens | serpapi | small brand |

## Reviews (`reviews/`)

Review text for the dataset listings, for promise vs proof. One JSONL file per
ASIN, lines `{r: rating, t: title, x: text, h: helpful votes}`, written by
`bun apps/cli/src/extract-reviews.ts <reviews.jsonl>...` from the Amazon
Reviews 2023 files (kept out of git). Up to 400 reviews per product: up to
300 that mention a keyword of a claim the listing makes, round-robin across
those claims, and a random remainder. Both picks are seeded, so re-running
gives the same files.

So "N reviews mention it" in a report counts the saved subset, not all of the
product's reviews (Pentel B097CF46RC has 5,076 in the dataset, 400 saved).
The water bottles have no review file locally, and live SerpApi listings never
get reviews: a 2026 page isn't the product the 2023 reviews were written about.
