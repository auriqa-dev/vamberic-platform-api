# Offer Architecture application

The workspace Offer Architecture screen is a direct application workflow, not an Agent registration or runtime capability. It extends the existing versioned Value Equation and Offer foundation; see `offer-foundation.md` for lifecycle rules.

`services/offer-architecture/application.ts` coordinates approved Hive inputs, fresh Brand Kit context, optional workspace customer patterns, persistent generation events and atomic offer/design saves. Routes live under `/api/v1/hvm/workspaces/:workspaceId/offer-architecture`. Both delegated Queens and direct client administrators use existing workspace authority.

Research uses one server-side Responses web-search discovery request, then the shared public-page reader validates URLs, DNS and redirects. Only retrieved sources enter competitor evidence. Unavailable sources produce limitations, not invented evidence. Discovery input is restricted to product name/description and company website; CRM aggregates, private names and contact details are not sent to web search. Draft generation receives approved business context plus research snippets. Model output is schema-validated once; no per-field validation LLM cascade. Research/usage metadata remain on the generation event.

Targeting and research guidance lives in market-context stage groups: buying situations, signals, sources, questions, inclusions, exclusions, priorities, personalisation evidence, value messages, proof, next steps. These are hypotheses/guidance until human review. Approved offer revisions retain the design snapshot. `GET .../approved-brief/:id` reads only the active approved offer version and retrieves current approved brand expression for future consumers. No marketing activation follows approval.

Customer context is optional and empty-safe. Only active workspace organisations explicitly typed customer are sampled (100 by stable ID); industry/country/region counts are labelled sampled, never represented as qualified ICP accounts. Research document ingestion and target/contact materialisation remain separate future workflows.

Working edits use expected timestamps; draft sources are pinned and rechecked. Generation request keys deduplicate network retries and a workspace lock serializes starts. Reauthorization precedes persistence. A six-minute lease exposes abandoned work as interrupted; late completions cannot persist. Restarting can lose in-flight AI work, but never partially create an offer/design pair. Users may retry after interruption.

Production setup reuses HVM_PSU_API_KEY and HVM_PSU_OPENAI_PROJECT. Optional overrides HVM_OFFER_MODEL and HVM_RESEARCH_MODEL default to gpt-6-luna and gpt-6-luna. No new secret or IAM grants are required. Official API source consulted: https://developers.openai.com/api/docs/guides/tools-web-search

Frontend form descriptors in hvm-app/src/data/offer/fields.json derive from OfferContentSchema and CompetitiveAnalysisSchema via offerMongoStructure. They are fixed code-owned descriptors, not an extensible generic capability framework. Update them when those schemas change; canonical API validation remains authoritative.
