# Architecture diagrams

Excalidraw files. Open one at excalidraw.com (menu > Open, or drag it in). Each has an SVG export alongside for reading on GitHub.

- [01-salesduo-fit](01-salesduo-fit.svg): the four SalesDuo surfaces the audit plugs into, and the endpoint each one calls.
- [02-system](02-system.svg): browser and widget, Express API, MySQL, Redis/BullMQ, worker, runAudit, Gemini, SerpApi, the response cache and fixtures.
- [03a-audit-pipeline](03a-audit-pipeline.svg): runAudit steps 1-10 in code order, from fetch to hidden answers, with model steps and code steps marked.
- [03b-audit-pipeline](03b-audit-pipeline.svg): steps 11-15 (promise vs proof, competitors, gaps, briefs, faithfulness) and the calls and cost per audit.
- [04a-trust-layer](04a-trust-layer.svg): each model output for grades and images, and the code check that follows it.
- [04b-trust-layer](04b-trust-layer.svg): the same for briefs, the judge, contradictions and review labels, with the "and leaking" example.
- [05-any-category](05-any-category.svg): how an audit finds its question set, estimates one when there is none, and how sets are mined offline from reviews.
- [06-job-lifecycle](06-job-lifecycle.svg): the states of an audit row and every way it moves between them.
- [07-evals-and-cost](07-evals-and-cost.svg): the gold set, the eval runner, the CI check and the headline numbers.
