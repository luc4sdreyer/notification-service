# Notification Service: Design Brief

Implementation brief for the take-home assignment. Read this fully before writing code.

## 1. Goal and constraints

- Small notification service in Node.js + TypeScript, about 2 hours of effort.
- The reviewers say they want engineering judgment and well-reasoned decisions, not feature count. **Keep the code small.** If something is not in this brief, do not add it; note it under "Future improvements" in the README instead.
- In-memory only. No database, no real providers, no auth.

## 2. Decisions (already confirmed, do not revisit)

| Area | Decision | Rationale |
|---|---|---|
| Framework | Express 5 + `express-openapi-validator` `>=5.5.0` | Boring and widely known; the spec file drives validation directly. Express 5 support is confirmed from v5.5.0 of the validator, so pin at or above that. |
| Contract | `openapi.yaml` (OpenAPI 3.0.3) is the single source of truth; types generated with `openapi-typescript` | Contract-first bonus; code cannot drift from the spec. 3.0.3 is the validator's longest-supported path; 3.1 also works from v5.4.0. |
| Processing | In-memory queue + worker behind a `Dispatcher` interface | POST returns immediately with `queued`; the interface is the seam for Pub/Sub or SQS. |
| Failure handling | `failed` is terminal, no retries | Fits the three given statuses and the time budget. Retries are described in the README. |
| Errors | RFC 9457 `application/problem+json` for every error | One standard shape, one middleware. |
| Recipient checks | Per channel, in the domain layer (not in the spec) | `oneOf` + discriminator in the spec gives unreadable validator errors. Trade-off: the rule is documented in the spec description rather than enforced by it. This is the only validation outside the spec; everything the assignment lists as a validation example is enforced by the spec itself. |
| Ops | Multi-stage Dockerfile + `GET /health` | Deployability talking point at low cost. |
| Tests | Vitest + supertest | Fast, TypeScript-native, API-level tests against the real app. |
| Package manager | pnpm, pinned, with supply-chain restrictions (section 12) | Not required by the assignment; a deliberate hygiene choice given recent npm ecosystem compromises. Costs almost nothing and is a good discussion point. |
| Idempotency | **Not implemented.** README improvement only. | Subtle (key scope, expiry, concurrent duplicates) and out of proportion for the scope. |

## 3. API contract

All of this lives in `openapi.yaml` (OpenAPI 3.0.3).

### POST /notifications

Request body (`application/json`, `additionalProperties: false`, all fields required):

| Field | Type | Rules in spec |
|---|---|---|
| `recipient` | string | minLength 1, maxLength 320 |
| `channel` | string | enum: `email`, `sms`, `push` |
| `message` | string | minLength 1, maxLength 1000, pattern `\S` (at least one non-whitespace character) |

The max lengths are assumptions (the assignment gives none); list them under "Assumptions" in the README.

Responses:

- `202 Accepted` with `{ "id": "<uuid>", "status": "queued" }` and a `Location: /notifications/{id}` header. 202 because the work is accepted but not done.
- `400` problem+json for schema violations, malformed JSON and recipient format failures.
- `415` problem+json for a non-JSON content type.

"Message is not empty" is enforced entirely by the spec: minLength rejects `""` and the pattern rejects whitespace-only values. No domain check for it.

### GET /notifications/{id}

- Path param `id`: string, format uuid.
- `200` with `{ "id", "channel", "status" }`. Deliberately does not return `recipient` or `message` (not required, and it avoids echoing personal data).
- `400` if `id` is not a UUID, `404` if unknown.

### GET /health

- `200` with `{ "status": "ok" }`.

### Error shape (RFC 9457)

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "errors": [{ "path": "/body/channel", "message": "must be equal to one of the allowed values" }]
}
```

`errors` is present only for validation failures. Unexpected errors return 500 with a generic detail; never leak stack traces.

## 4. Structure

```
openapi.yaml
src/
  server.ts                 # composition root: build deps, listen, graceful shutdown
  app.ts                    # createApp(deps): Express app, validator, routes, error middleware
  config.ts                 # env parsing with defaults
  http/
    notificationRoutes.ts
    errorHandler.ts         # maps all errors to problem+json
  domain/
    notification.ts         # types, status transitions
    recipientValidation.ts  # per-channel checks
    errors.ts               # ValidationError, NotFoundError
  service/
    notificationService.ts  # create, get, process
  ports/
    notificationRepository.ts
    dispatcher.ts
    channelSender.ts
  adapters/
    inMemoryNotificationRepository.ts
    inMemoryDispatcher.ts
    simulatedSender.ts
  generated/
    api.d.ts                # from openapi-typescript, committed
test/
  api.test.ts
  processing.test.ts
  domain.test.ts
package.json                # packageManager + engines pinned
pnpm-workspace.yaml         # pnpm settings (section 12)
pnpm-lock.yaml              # committed
Dockerfile
README.md
AI_USAGE.md
```

Rule: nothing under `domain/`, `service/` or `ports/` imports Express.

## 5. Core types and interfaces

```ts
type Channel = 'email' | 'sms' | 'push';
type Status = 'queued' | 'sent' | 'failed';

interface Notification {
  id: string;            // crypto.randomUUID()
  recipient: string;
  channel: Channel;
  message: string;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationRepository {
  save(n: Notification): Promise<void>;
  findById(id: string): Promise<Notification | undefined>;
  updateStatus(id: string, status: Status): Promise<void>;
}

interface ChannelSender {
  send(n: Notification): Promise<void>;   // throws on failure
}

interface Dispatcher {
  enqueue(id: string): void;
  drain(): Promise<void>;                 // resolves when queue is empty and nothing is in flight
}
```

Interfaces are async even though the adapters are in-memory, so a real store or broker can replace them without changing callers.

### Status transitions

- Allowed: `queued → sent`, `queued → failed`. Nothing else.
- Enforce in one function in `domain/notification.ts`; an illegal transition throws.

### Service

- `create(input)`: run recipient validation, build the record with status `queued`, save, enqueue, return it.
- `get(id)`: return the record or throw `NotFoundError`.
- `process(id)`: load, call the sender for its channel, set `sent`; on any thrown error set `failed`. Must never throw to the worker.

### InMemoryDispatcher

- FIFO array of ids, configurable concurrency (default 5).
- Takes a handler `(id) => Promise<void>` at construction (the service's `process`).
- A handler rejection is caught and logged; it must not stop the worker.
- `drain()` exists for tests and for graceful shutdown.

### SimulatedSender

- One class, constructed per channel or shared via a `Record<Channel, ChannelSender>`.
- Options: `delayMs`, `failureRate`, and an injectable `random: () => number` (default `Math.random`).
- Tests inject a sender that always succeeds or always fails. No test depends on randomness or real time.

### Recipient validation

| Channel | Rule |
|---|---|
| email | pragmatic pattern: `something@something.tld`, no whitespace. Not full RFC 5322, and say so. |
| sms | E.164: `^\+[1-9]\d{1,14}$` |
| push | non-empty token, no whitespace |

Failure throws `ValidationError` with path `/body/recipient`, mapped to 400 in the same shape as spec validation errors.

## 6. Config (env)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `SEND_DELAY_MS` | 100 | Simulated send latency |
| `SEND_FAILURE_RATE` | 0.1 | Fraction of simulated sends that fail |
| `WORKER_CONCURRENCY` | 5 | Parallel sends |

## 7. Cross-cutting

- **Error middleware:** handles validator errors (they carry `status` and `errors`), JSON parse errors, domain errors, and everything else as 500.
- **Logging:** minimal structured `console` lines (event, id, channel, status). Never log `recipient` or `message`.
- **Graceful shutdown:** on SIGTERM stop accepting connections, `drain()`, exit. Keep it to a few lines.
- **TypeScript:** `strict: true`. Pin the current Node LTS in `engines` and `.nvmrc`.
- **Scripts:** `dev`, `build`, `start`, `test`, `typecheck`, `generate:types`. No lint setup; it costs time and adds nothing to the discussion.

## 8. Tests

API level (supertest against `createApp` with injected deps):

1. POST valid → 202, body has uuid `id` and `status: "queued"`, `Location` header set.
2. POST missing each required field → 400 problem+json naming the field.
3. POST unsupported channel → 400.
4. POST empty message, and whitespace-only message → 400.
5. POST unknown extra property → 400.
6. POST malformed JSON → 400 problem+json.
7. POST invalid recipient for each channel → 400 with path `/body/recipient`.
8. GET unknown uuid → 404; GET non-uuid → 400.
9. GET /health → 200.

Processing:

10. Create with always-succeeding sender, `await dispatcher.drain()`, GET → `sent`.
11. Create with always-failing sender, drain, GET → `failed`.
12. GET before the worker runs → `queued` (use a sender gated on a promise the test controls).
13. A failing notification does not block the next one in the queue.

Domain:

14. Illegal transitions (`sent → failed`, `failed → sent`) throw.

Optional if time allows: enable `validateResponses` in the test app so responses are checked against the spec.

## 9. Build order

Each step leaves a working, committable state. Commit after each.

Steps 1 to 5 plus step 8 are the assignment (core requirements and the OpenAPI bonus). Steps 6 and 7 are extras. The assignment expects about 2 hours and explicitly does not reward feature count, so if time runs over, cut step 7 first, then step 6, and move whatever was cut to "Future improvements".

1. Project scaffold with pnpm and the settings in section 12 in place **before the first install**, then `openapi.yaml` and generated types.
2. Both endpoints with spec validation and in-memory repository.
3. Dispatcher, simulated sender, status transitions.
4. Tests 1 to 14.
5. Problem+json error middleware (tests updated to assert the shape).
6. Per-channel recipient validation.
7. `/health`, Dockerfile, graceful shutdown.
8. README and AI usage notes.

## 10. README outline

1. What it is, in three sentences.
2. Setup, run, test, Docker commands, with `curl` examples. Prerequisites: Node (pinned version) and pnpm via `corepack enable`. Offer the Docker commands as the path for a reviewer who does not have pnpm. Add two or three sentences on why pnpm and which restrictions are set.
3. Assumptions made where the assignment is silent: 202 for POST, field max lengths, GET returning only id, channel and status, UUID ids.
4. Design decisions and trade-offs (the table in section 2, in prose).
5. Error handling: the problem+json shape and the status code for each failure.
6. Testing approach: what is tested at API level and why, and how async processing is made deterministic.
7. Known limitations: state lost on restart, single process, simulated sending.
8. AI usage: a short summary with a link to `AI_USAGE.md`.
9. Future improvements (this is where scalability and reliability are addressed):
   - **Idempotency:** `Idempotency-Key` header on POST so client retries do not create duplicates. Considered and left out; needs decisions on key scope, expiry, a body hash to detect key reuse with a different payload, and handling of concurrent duplicates.
   - Durable queue (Pub/Sub, SQS) with at-least-once delivery and idempotent consumers.
   - Retries with exponential backoff and jitter, a dead-letter queue, and a distinction between transient and permanent failures.
   - Persistent store, with the status update and the enqueue made atomic (outbox pattern).
   - Real provider adapters behind `ChannelSender`, with timeouts and circuit breaking.
   - Observability: metrics per channel and status, tracing, correlation ids.
   - Auth, rate limiting, per-channel message limits.
   - Delivery callbacks or webhooks instead of polling.

## 11. AI usage notes (`AI_USAGE.md`)

Required by the assignment. It must be truthful, so **keep a running log while implementing** rather than reconstructing it afterwards.

- Tools: Claude (chat) for the high-level design and this brief; Claude Code for implementation.
- Tasks assisted: design options and trade-offs, scaffolding, tests, README draft.
- One example accepted: record a real one during implementation, with the file and why it was acceptable as-is.
- One example modified or rejected: record a real one during implementation. Two design-stage candidates already exist:
  - Per-channel recipient rules expressed in the spec with `oneOf` + discriminator were rejected in favour of domain-layer checks, for readable errors.
  - An `Idempotency-Key` feature was proposed, then dropped for scope and moved to future improvements.
- Validation: describe only what was actually done. Planned: automated tests, manual `curl` runs against the running service and the Docker image, and a line-by-line review of the generated code by the author.

Leave the accepted/rejected entries as clearly marked placeholders for the author to complete; do not invent examples.

## 12. Tooling and supply chain

Not an assignment requirement. The aim is sensible defaults with a few lines of config, not a security project.

### Package manager

- **pnpm**, pinned exactly through the `packageManager` field in `package.json` so corepack gives every machine the same version. Use the current stable release line and confirm which one that is at scaffold time.
- `engines.node` and `.nvmrc` pinned to the current Node LTS.
- `pnpm-lock.yaml` is committed. Every install outside of deliberately adding a dependency uses `pnpm install --frozen-lockfile` (README, Dockerfile).

### pnpm settings (`pnpm-workspace.yaml`)

```yaml
minimumReleaseAge: 1440       # minutes = 24h; no version younger than a day is installed
blockExoticSubdeps: true      # transitive deps must come from the registry, not git or tarball URLs
trustPolicy: no-downgrade     # refuse a version whose publish trust level is weaker than earlier versions
strictDepBuilds: true         # fail the install on any unreviewed dependency build script
savePrefix: ''                # exact versions in package.json, no ^ ranges
allowBuilds: {}               # no install scripts allowed; add a package only if it is proven necessary
```

Rules for these settings:

- Check each setting name against https://pnpm.io/settings for the pinned pnpm version before relying on it; names and defaults have changed between major versions.
- Do not relax a setting to make an install pass. If `minimumReleaseAge` blocks a version, choose the previous version. If `trustPolicy` rejects an old, widely used package, prefer `trustPolicyIgnoreAfter` over turning the policy off, and note it in the README.
- If a dependency genuinely needs its build script (for example a native binary used by the test runner), add that one package to `allowBuilds` and say why in a comment.

### Dependency discipline

The smallest attack surface is the fewest dependencies.

- **Runtime:** `express`, `express-openapi-validator`. Nothing else.
- **Dev:** `typescript`, `tsx`, `vitest`, `supertest`, `openapi-typescript`, and the `@types/*` packages they need.
- Use Node built-ins instead of packages: `crypto.randomUUID()` for ids, `process.env` for config (no dotenv), no utility libraries, no logging library.
- **Do not add any dependency outside this list without asking first.**
- No `npx` or `pnpm dlx` for unpinned tools. Anything that runs is a locked devDependency invoked through a script.

### Dockerfile

- Base image pinned to a specific Node LTS version tag (slim or alpine).
- Multi-stage: build with dev dependencies, then a runtime stage with `pnpm install --prod --frozen-lockfile` and the compiled output only.
- Runs as the non-root `node` user.

### Audit

- `pnpm audit` as an `audit` script. Run it once before submission and record the result in the README.
