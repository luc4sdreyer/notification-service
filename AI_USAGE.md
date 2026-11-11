# AI usage

## Tools

- Claude (chat): design discussion and the implementation brief in [`docs/DESIGN.md`](docs/DESIGN.md).
- Claude Code: implementation, tests, Dockerfile, toolchain debugging, an automated code review (`/code-review`), and first drafts of the README and this file.

## What AI helped with

- Weighing design options: framework, how much validation goes in the spec versus the domain, sync versus async processing, retries, idempotency.
- Project scaffolding, including the pnpm supply-chain settings.
- The OpenAPI spec, the application code and the tests.
- Tracking down a test-runner crash to a broken native binary in a transitive dependency.
- Reviewing the UTF-8 fix for bugs.
- Drafting the README and this file, then a pass to remove AI writing patterns from both.

## Example accepted

`src/adapters/inMemoryDispatcher.ts`: the FIFO queue with bounded concurrency and a `drain()` that resolves when the queue is empty and nothing is in flight.

## Examples modified or rejected

From the design stage:
- Per-channel recipient rules written into the spec with `oneOf` + discriminator. Rejected in favour of a domain-layer check because the validator's errors for a failed `oneOf` are unreadable for clients.
- An `Idempotency-Key` feature was proposed, then dropped for scope and moved to future improvements.

From the first implementation pass, where Claude Code corrected its own output:
- Claude Code first installed TypeScript 7.0.2 (the native compiler), which pnpm resolved as latest. `openapi-typescript` needs the TS 5 compiler API (unmet peer `^5.x`), so Claude Code pinned TypeScript to 5.9.3.
- Vitest 5 crashed with `Illegal instruction`. Claude Code traced it to the rolldown 1.2.18 native binding (1.2.16 loads fine on the same machine). A fixed-looking rolldown came out that morning, but picking it up would have meant relaxing `minimumReleaseAge`. Claude Code pinned `rolldown` to 1.2.16 with an override and a comment instead.
- The first version of the validator setup reported only the first error per request. Claude Code turned on `allErrors` after a manual `curl` run showed one error for a body with four problems.
- The Dockerfile installs production dependencies in a separate stage and copies `node_modules` across, rather than running pnpm in the runtime stage as the brief suggested. That keeps pnpm and corepack out of the final image.

From my review of the result:
- The generated spec had `info.version: 0.1.0`, but the paths carried no version. I asked for the major version in the URI (`/v0/notifications`). Claude Code put the prefix in the spec paths rather than in a `servers` base URL, because the validator skips requests outside the base URL and unknown routes would lose their problem+json 404. It also added a contract test that fails when the paths and `info.version` disagree.
- I asked whether UTF-8 input was tested. It wasn't. A probe showed that invalid bytes were silently replaced with U+FFFD and the result was accepted and delivered. That led to the UTF-8 checks in `src/http/requireUtf8.ts` and `test/utf8.test.ts`.
- The automated review of that fix found a real gap: a lone surrogate written as a JSON escape (`\ud83d`) is valid bytes on the wire and still reached the sender as U+FFFD. The review's suggested fix, checking only the parsed strings, would have reopened the original bug, because invalid bytes are already U+FFFD (a valid character) by the time the body is parsed. Both checks were kept. Its smaller findings were accepted: `isUtf8()` instead of a throwaway decode, the charset checked from the header before the body is read, and charset tests that reach that check. One finding was rejected as hypothetical: an error path that needs the JSON parser to pass a null encoding, which it never does.

## How the solution was validated

- Automated tests: 55 Vitest + supertest tests (API, processing, domain, contract, UTF-8), with response validation against the spec turned on. `pnpm typecheck` passes under `strict`.
- Checking the tests themselves: for the versioning test and both UTF-8 body checks, the code was broken on purpose (version bumped without moving the paths, each check disabled in turn) to confirm the matching tests fail.
- Manual runs: `curl` against the dev server and the compiled build, covering 202 + `Location`, `queued → sent`, validation errors, malformed JSON, 415, non-UUID and unknown ids, 405 and `/health`. A `SIGTERM` during a slow send confirmed that shutdown drains the queue before exiting.
- Clean install: `rm -rf node_modules && pnpm install --frozen-lockfile`, then the tests again.
- `pnpm audit`: no known vulnerabilities (2026-11-11).
- Docker image: built with `--no-cache` (Docker 29.9.3). The lockfile passed pnpm's supply-chain checks inside the build. The runtime image runs as `node` and holds only `dist`, production dependencies, `openapi.yaml` and `package.json`. `curl` against the container covered `/health`, 202 + `Location`, `queued` then `sent`, validation errors, an invalid SMS recipient, 415, 400 and 404 on GET. `docker stop` during a 3-second send let the send finish and exited 0. The image was rebuilt after the versioning and UTF-8 changes, and the `/v0` paths, invalid bytes, a lone surrogate escape and a UTF-16 charset were checked again in the container.
- Author review completed.
