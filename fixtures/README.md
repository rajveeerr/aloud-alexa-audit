# Fixtures

Saved inputs and recorded model answers, so development, tests and the demo never call a paid or
rate-limited API. 25 listings in four categories.

- `serpapi/`: live Amazon pages through SerpApi's `amazon_product` engine, fetched October 2026. The
  sponsored and related-product blocks are removed; the related products' ASINs are kept as
  `related_asins`, a fallback for picking competitors.
- `dataset/`: product records from Amazon Reviews 2023 (McAuley Lab, UCSD; research use, data up to
  September 2023).
- `intents/`: one question set per category. `basis` says whether it was mined from reviews or
  estimated; `reviewed` says whether a person has checked it.
- `image-claims/`: claims transcribed from each listing's images, per source.
- `llm/`: recorded model answers, keyed by a hash of model, prompt version, schema and inputs.

| ASIN | Source | Category | Brand | Note |
|---|---|---|---|---|
| B0C9W8DD9S | serpapi | Gel Ink Rollerball Pens | Ddaowanx | The small-brand example: 2 hidden answers |
| B001GAOTSW | serpapi | Gel Ink Rollerball Pens | PILOT | |
| B097CF46RC | serpapi | Gel Ink Rollerball Pens | Pentel | Resolves to B018UJ2YWE; title says 4-Pk, included components say 3 |
| B0BGPYR8Q3 | serpapi | Gel Ink Rollerball Pens | BIC | Resolves to B0744D6P4V |
| B0BSMKF5BQ | serpapi | Gel Ink Rollerball Pens | Sharpie | Resolves to a green and blue bundle, B0BYPTVZH6 |
| B09YP9YYZG | dataset | Gel Ink Rollerball Pens | PILOT | |
| B097CF46RC | dataset | Gel Ink Rollerball Pens | Pentel | Description says 1.0mm tip, attribute says 0.7 |
| B0BSMKF5BQ | dataset | Gel Ink Rollerball Pens | SHARPIE | |
| B0143LMAEK | dataset | Gel Ink Rollerball Pens | Uni-ball | Title says 6 pens, description says 3 |
| B08CMWPFR1 | dataset | Gel Ink Rollerball Pens | Scentco | No bullets, no description |
| B08PD98HYG | dataset | Mechanical Pencils | Pentel | |
| B0BZQYP39K | dataset | Mechanical Pencils | BIC | |
| B0BM4LCNPL | dataset | Mechanical Pencils | Pica | |
| B077Q4B6YN | dataset | Mechanical Pencils | Paper Mate | |
| B0BKSDXL36 | dataset | Mechanical Pencils | Parker | |
| B09VD1Z3TK | dataset | Dry Erase Boards | U Brands | |
| B0B42X682C | dataset | Dry Erase Boards | Amazon Basics | Only 5 saved reviews: proof says not enough evidence |
| B0BLYMHFVY | dataset | Dry Erase Boards | VIZ-PRO | |
| B091NQVBF3 | dataset | Dry Erase Boards | Quartet | |
| B0BT55V3C5 | dataset | Dry Erase Boards | Scribbledo | |
| B00P6N6LC2 | dataset | Water Bottles | CamelBak | Question set estimated (no reviews mined) |
| B08GZ7ZYSC | dataset | Water Bottles | Polar Bottle | |
| B00G8QHUV2 | dataset | Water Bottles | Elite | |
| B0832N947Y | dataset | Water Bottles | RICWINANN | |
| B08QF3C1B1 | dataset | Water Bottles | GEMFUL | |

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
