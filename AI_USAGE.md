# AI usage

## Tools

- Claude (chat): design discussion and the implementation brief in [`docs/DESIGN.md`](docs/DESIGN.md).
- Claude Code: implementation, tests, Dockerfile, README draft.

## What AI helped with

- Weighing design options: framework, how much validation goes in the spec versus the domain, sync versus async processing, retries, idempotency.
- Project scaffolding, including the pnpm supply-chain settings.
- The OpenAPI spec, the application code and the tests.
- First drafts of the README and this file.

## Example accepted

`src/adapters/inMemoryDispatcher.ts`: the FIFO queue with bounded concurrency and a `drain()` that resolves when the queue is empty and nothing is in flight.

## Example modified or rejected

From the design stage:
- Per-channel recipient rules written into the spec with `oneOf` + discriminator. Rejected in favour of a domain-layer check because the validator's errors for a failed `oneOf` are unreadable for clients.
- An `Idempotency-Key` feature was proposed, then dropped for scope and moved to future improvements.

From the implementation stage:
- Claude Code first installed TypeScript 7.0.2 (the native compiler), which pnpm resolved as latest. `openapi-typescript` needs the TS 5 compiler API (unmet peer `^5.x`), so Claude Code pinned TypeScript to 5.9.3.
- Vitest 5 crashed with `Illegal instruction`. Claude Code traced it to the rolldown 1.2.18 native binding (1.2.16 loads fine on the same machine). A fixed-looking rolldown came out that morning, but picking it up would have meant relaxing `minimumReleaseAge`. Claude Code pinned `rolldown` to 1.2.16 with an override and a comment instead.
- The first version of the validator setup reported only the first error per request. Claude Code turned on `allErrors` after a manual `curl` run showed one error for a body with four problems.
- The Dockerfile installs production dependencies in a separate stage and copies `node_modules` across, rather than running pnpm in the runtime stage as the brief suggested. That keeps pnpm and corepack out of the final image.

## How the solution was validated

- Automated tests: 36 Vitest + supertest tests (API, processing, domain, contract), with response validation against the spec turned on. `pnpm typecheck` passes under `strict`.
- Manual runs: `curl` against the dev server and the compiled build, covering 202 + `Location`, `queued → sent`, validation errors, malformed JSON, 415, non-UUID and unknown ids, 405 and `/health`. A `SIGTERM` during a slow send confirmed that shutdown drains the queue before exiting.
- Clean install: `rm -rf node_modules && pnpm install --frozen-lockfile`, then the tests again.
- `pnpm audit`: no known vulnerabilities (2026-11-11).
- Docker image: built with `--no-cache` (Docker 29.9.3). The lockfile passed pnpm's supply-chain checks inside the build. The runtime image runs as `node` and holds only `dist`, production dependencies, `openapi.yaml` and `package.json`. `curl` against the container covered `/health`, 202 + `Location`, `queued` then `sent`, validation errors, an invalid SMS recipient, 415, 400 and 404 on GET. `docker stop` during a 3-second send let the send finish and exited 0.
- Code review: **TODO (author):** line-by-line review of the generated code.
