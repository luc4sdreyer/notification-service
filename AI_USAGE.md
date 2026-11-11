# AI usage

## Tools

- **Claude (chat)**: design discussion and the implementation brief in [`docs/DESIGN.md`](docs/DESIGN.md).
- **Claude Code**: implementation, tests, Dockerfile, README draft.

## What AI helped with

- Weighing design options: framework, how much validation goes in the spec versus the domain, sync versus async processing, retries, idempotency.
- Project scaffolding, including the pnpm supply-chain settings.
- The OpenAPI spec, the application code and the tests.
- First drafts of the README and this file.

## Example accepted

> **TODO (author):** pick one real example and say which file it's in and why it was acceptable as-is.
>
> Candidates from this implementation:
> - `src/adapters/inMemoryDispatcher.ts`: the FIFO queue with bounded concurrency and a `drain()` that resolves when the queue is empty and nothing is in flight.
> - `test/helpers.ts` `gatedSender()`: makes the "status is still `queued`" test deterministic without timers.

## Example modified or rejected

> **TODO (author):** confirm or replace with your own.
>
> Candidates from the design stage:
> - Per-channel recipient rules written into the spec with `oneOf` + discriminator. Rejected in favour of a domain-layer check because the validator's errors for a failed `oneOf` are unreadable for clients.
> - An `Idempotency-Key` feature was proposed, then dropped for scope and moved to future improvements.
>
> Candidates from implementation (decisions taken during the session, for you to review):
> - pnpm resolved TypeScript 7.0.2 (the native compiler), but `openapi-typescript` needs the TS 5 compiler API (unmet peer `^5.x`). TypeScript was pinned to 5.9.3 instead.
> - Vitest 5 crashed with `Illegal instruction`. The cause was the rolldown 1.2.18 native binding (1.2.16 loads fine on the same machine). Instead of relaxing `minimumReleaseAge` to pick up the release from the same day, `rolldown` was pinned to 1.2.16 with an override and a comment.
> - The validator originally reported only the first error per request. `allErrors` was turned on so a client sees every problem at once.
> - The Dockerfile installs production dependencies in a separate stage and copies `node_modules` across, rather than running pnpm in the runtime stage as the brief suggested. That keeps pnpm and corepack out of the final image.

## How the solution was validated

Only what was actually done:

- **Automated tests:** 34 Vitest + supertest tests (API, processing, domain), with response validation against the spec turned on. `pnpm typecheck` passes under `strict`.
- **Manual runs:** `curl` against the dev server and the compiled build, covering 202 + `Location`, `queued → sent`, validation errors, malformed JSON, 415, non-UUID and unknown ids, 405 and `/health`. A `SIGTERM` during a slow send confirmed that shutdown drains the queue before exiting.
- **Clean install:** `rm -rf node_modules && pnpm install --frozen-lockfile`, then the tests again.
- **`pnpm audit`:** no known vulnerabilities (2026-11-11).
- **Docker image:** **TODO (author):** not built yet; Docker wasn't available on the dev machine. Build and run it, then update this line.
- **Code review:** **TODO (author):** line-by-line review of the generated code.
