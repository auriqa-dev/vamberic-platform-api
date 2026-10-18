# Runtime protocol 1.2 / Result schema 2 development handoff

Canonical contracts, generated JavaScript/declarations/source maps, JSON schemas,
and fixtures originate in `vamberic-agent-runtime`. Run its build, `schemas`, then
`scripts/release-protocol.ts` to reproduce this private development handoff.
Never edit copied artifacts independently. `provenance.json` inventories every
copied file with its SHA-256 digest. Both repository artifact checks must pass.

The shared reader accepts declared Protocol 1.1 and 1.2. A 1.1 input resume cannot
carry provenance; a 1.2 input resume requires a bounded Platform-authored
attestation. No defaults upgrade old records. Result schema remains exactly 2.
The default fixture paths preserve historical 1.1 bytes; `fixtures/v1.2` contains
new fixtures and `historical/v1.0` preserves the earlier fixture archive. Protocol
1.0/Result 1 is still outside the current reader contract, as before this change.

JSON Schema is structural. Zod/canonical digest validation and authenticated
Platform delivery remain authoritative for cross-field bindings and authorship.
Mongo persistence does not store resume envelopes: provenance is in the existing
input_answered event payload and is validated in the transaction and on claim.

This is not a published immutable production release. Publication, credentials,
deployment and schema application remain separate gates.
