# Notification Service

A small HTTP service that accepts notifications (email, SMS, push), stores them in memory, and delivers them asynchronously through a simulated provider. Clients get a `202 Accepted` with an id straight away and poll `GET /notifications/{id}` to see whether the notification ended up `sent` or `failed`. The API is defined contract-first in [`openapi.yaml`](openapi.yaml), which validates every request and generates the TypeScript types.

## Running it

**Prerequisites:** Node 26.13.0 (see `.nvmrc`) and pnpm 12.18.0. Node 25+ no longer ships corepack, so install it once with `npm i -g corepack@0.36.0`, then run `corepack enable pnpm`. Corepack reads the exact pnpm version from `package.json`. If you don't want to install either, use the Docker commands below.

```sh
pnpm install --frozen-lockfile
pnpm dev            # watch mode on http://localhost:3000
pnpm test           # vitest
pnpm typecheck
pnpm build && pnpm start
```

Docker:

```sh
docker build -t notification-service .
docker run --rm -p 3000:3000 notification-service
```

Configuration (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `SEND_DELAY_MS` | 100 | Simulated send latency |
| `SEND_FAILURE_RATE` | 0.1 | Fraction of simulated sends that fail (0 to 1) |
| `WORKER_CONCURRENCY` | 5 | Parallel sends |

Example session:

```sh
$ curl -i -X POST localhost:3000/notifications \
    -H 'Content-Type: application/json' \
    -d '{"recipient":"user@example.com","channel":"email","message":"Your order has shipped."}'
HTTP/1.1 202 Accepted
Location: /notifications/8a97468c-ca36-465a-88e7-8e584ad889eb
{"id":"8a97468c-ca36-465a-88e7-8e584ad889eb","status":"queued"}

$ curl localhost:3000/notifications/8a97468c-ca36-465a-88e7-8e584ad889eb
{"id":"8a97468c-ca36-465a-88e7-8e584ad889eb","channel":"email","status":"sent"}

$ curl -X POST localhost:3000/notifications -H 'Content-Type: application/json' \
    -d '{"channel":"fax","message":""}'
{"type":"about:blank","title":"Bad Request","status":400,"detail":"Request validation failed",
 "errors":[{"path":"/body/recipient","message":"must have required property 'recipient'"},
           {"path":"/body/channel","message":"must be equal to one of the allowed values: email, sms, push"},
           {"path":"/body/message","message":"must NOT have fewer than 1 characters"}, ...]}

$ curl localhost:3000/health
{"status":"ok"}
```

### Why pnpm

The assignment doesn't require it. After the recent npm supply-chain compromises I wanted cheap guard rails, and pnpm provides them with a few lines of config in [`pnpm-workspace.yaml`](pnpm-workspace.yaml):

- `minimumReleaseAge: 1440`: nothing published in the last 24 hours gets installed. Most malicious releases are caught and pulled within that window.
- `blockExoticSubdeps` and `trustPolicy: no-downgrade`: transitive dependencies must come from the registry, and a version with weaker publish provenance than its predecessors is refused.
- `strictDepBuilds` and `allowBuilds`: no install scripts run unless they are reviewed. esbuild's postinstall is explicitly denied because its platform binary arrives as an optional dependency anyway.
- Exact versions in `package.json`, a committed lockfile, and `--frozen-lockfile` everywhere.

The runtime has two dependencies, `express` and `express-openapi-validator`. Everything else uses Node built-ins (`crypto.randomUUID`, `process.env`, `console`).

There is one override. Vitest 5 pulls in rolldown 1.2.18, whose native binding crashes with `SIGILL` on my CPU (Ryzen 5600X), so `rolldown` is pinned to 1.2.16. A newer rolldown appeared on the day of writing, but it's still inside the 24-hour release-age window, which is the situation that setting is for.

`pnpm audit` on 2026-11-11: no known vulnerabilities.

## Assumptions

Where the assignment is silent:

- **`202 Accepted` for POST**, with a `Location` header. Delivery happens after the response, so nothing has been "created" in the sense of done.
- **Field limits**: `recipient` 1 to 320 characters (the practical maximum for an email address), `message` 1 to 1000 characters and at least one non-whitespace character. Unknown properties are rejected.
- **GET returns only `id`, `channel` and `status`**, as specified. It deliberately doesn't echo `recipient` or `message` back, which keeps personal data out of responses.
- **Ids are UUIDs** (v4, `crypto.randomUUID()`), so a GET with a non-UUID id is a 400 and an unknown UUID is a 404.
- **Recipient formats**: email must look like `name@domain.tld` with no whitespace. This is a pragmatic check, not full RFC 5322. SMS must be E.164 (`+14155550123`). A push token must be non-empty with no whitespace.

## Design decisions and trade-offs

**Express 5 with `express-openapi-validator`.** It's a well-known framework, and the validator reads `openapi.yaml` directly, so the spec is enforced at runtime instead of mirrored in hand-written checks. Types come from the same file through `openapi-typescript`, and the domain's `Channel` and `Status` types are derived from them. If someone edits the spec without updating the code, the typecheck fails.

**Contract first, with one exception.** Every validation the assignment lists (required fields, supported channels, non-empty message, schema match) is enforced by the spec alone. The one rule outside the spec is the per-channel recipient format. Expressing it in OpenAPI needs a `oneOf` with a discriminator, which makes the validator report a pile of errors from every branch that didn't match. That's hard for a client to act on. The domain check returns one clear error in the same shape and on the same path (`/body/recipient`). The trade-off is that the spec documents this rule in prose rather than enforcing it.

**Asynchronous processing behind a `Dispatcher` interface.** POST saves the record, enqueues its id and returns. A worker pool with bounded concurrency calls the channel's `ChannelSender` and moves the status to `sent` or `failed`. The in-memory FIFO queue is the simplest thing that behaves like a real broker. The `Dispatcher` interface is where Pub/Sub or SQS would plug in. The repository and sender sit behind interfaces too, and all of them are async even though the adapters are in-memory, so a real store or provider wouldn't change any callers. Nothing in `domain/`, `service/` or `ports/` imports Express.

**`failed` is terminal; no retries.** The assignment defines three statuses, and retries done properly need backoff, a retry limit, a dead-letter path and a way to tell transient errors from permanent ones. That's out of proportion here, so it's described under future improvements. Transitions are enforced in one function (`assertTransition`): only `queued → sent` and `queued → failed` are allowed.

**One error format.** Every error, including 404 for unknown routes, 405, 415 and malformed JSON, is RFC 9457 `application/problem+json` from a single middleware.

**No idempotency keys.** I considered an `Idempotency-Key` header on POST and left it out. Done properly it needs decisions on key scope and expiry, a body hash to catch a key reused with a different payload, and handling for concurrent duplicates. See future improvements.

## Error handling

All errors look like this (`errors` is present only for validation failures):

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed",
  "errors": [{ "path": "/body/channel", "message": "must be equal to one of the allowed values: email, sms, push" }]
}
```

| Situation | Status |
|---|---|
| Schema violation (missing field, bad channel, empty or whitespace message, extra property, oversized field) | 400, every violation listed |
| Invalid recipient for the channel | 400, path `/body/recipient` |
| Malformed JSON | 400 |
| `GET /notifications/{id}` with a non-UUID id | 400, path `/params/id` |
| Unknown notification id | 404 |
| Unknown route | 404 |
| Wrong method on a known route | 405, with an `Allow` header |
| Non-JSON `Content-Type` on POST | 415 |
| Anything unexpected | 500 with a generic message; details are logged, never returned |

Delivery failures aren't HTTP errors. They show up as `status: "failed"` on the notification. The worker catches every error, so one bad notification can't stop the queue.

Logs are one JSON line per event (`notification.queued`, `notification.sent`, `notification.failed`, ...) with the id, channel and status. Recipients and message bodies are never logged.

## Testing approach

`pnpm test` runs 34 Vitest tests in about a second.

- **API tests** ([`test/api.test.ts`](test/api.test.ts)) use supertest against the real `createApp` with the real validator, routes and error middleware. They cover the 202 response and `Location` header, each missing field, unsupported channel, empty and whitespace-only messages, extra properties, malformed JSON, 415, invalid and valid recipients per channel, GET 200/400/404 and `/health`. Every error test also asserts the problem+json shape. The test app runs with `validateResponses` on, so the responses are checked against the spec too. Testing at the HTTP level means the tests exercise the contract itself, since most validation lives in the spec.
- **Processing tests** ([`test/processing.test.ts`](test/processing.test.ts)) check that a successful send ends in `sent`, a failed send ends in `failed`, the status reads `queued` while a send is in progress, and a failure doesn't block the next item in the queue.
- **Domain tests** ([`test/domain.test.ts`](test/domain.test.ts)) cover allowed and illegal status transitions.

No test depends on timing or randomness. Tests inject senders that always succeed, always fail, or wait on a promise the test releases (`gatedSender`). `dispatcher.drain()` resolves once the queue is empty and nothing is in flight, so a test awaits it instead of sleeping. The simulated sender's randomness is injectable for the same reason.

## Known limitations

- All state is in memory. A restart loses every notification and anything still queued.
- Single process only. Running two instances would give two independent stores and queues.
- Sending is simulated: a configurable delay and a random failure rate per send.
- No auth, rate limiting or per-channel message limits (an SMS segment is much shorter than 1000 characters).

## AI usage

I used Claude for the design and Claude Code for the implementation. All generated code was reviewed, then validated with the test suite and manual `curl` runs. Details, including what I accepted and what I changed, are in [`AI_USAGE.md`](AI_USAGE.md).

## Future improvements

This is also where scalability and reliability come in.

- **Idempotency:** an `Idempotency-Key` header on POST so client retries don't create duplicates. This needs key scope, expiry, a stored body hash to reject a reused key with a different payload, and a lock or unique constraint for concurrent duplicates.
- **Durable queue** (Pub/Sub, SQS) behind the existing `Dispatcher`, with at-least-once delivery and idempotent consumers. Workers then scale horizontally and independently of the API.
- **Retries** with exponential backoff and jitter, a retry limit, a dead-letter queue, and a split between transient failures (timeouts, 5xx) and permanent ones (invalid number). This needs extra statuses such as `retrying`.
- **Persistent store**, with the record write and the enqueue made atomic through an outbox table, so a crash between the two can't lose or orphan a notification.
- **Real provider adapters** behind `ChannelSender`, with timeouts and circuit breakers per provider.
- **Observability:** metrics per channel and status (queue depth, send latency, failure rate), tracing, and correlation ids carried from request to worker.
- **Auth, rate limiting, per-channel message limits.**
- **Delivery callbacks or webhooks** so clients don't have to poll.
