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
