# Architecture

The diagrams are Mermaid, which GitHub renders inline. They describe the code as it is; file names link to the source.

## Components

Requests pass through a fixed middleware chain before reaching the routes. Anything that throws along the way goes to `errorHandler`, which writes the problem+json response. The dotted line from the spec is build time: `pnpm generate:types` turns it into the TypeScript types the domain and routes use. The service only knows the three ports; the in-memory adapters behind them are chosen in [`src/container.ts`](../src/container.ts). Nothing in `domain/`, `service/` or `ports/` imports Express.

```mermaid
flowchart TB
    client([Client])
    spec[/"openapi.yaml"/]

    subgraph http["HTTP layer · src/app.ts, src/http/"]
        direction TB
        utf8["utf8Json()<br/>charset check · isUtf8 · isWellFormed"]
        validator["express-openapi-validator<br/>request validation"]
        health["GET /health"]
        routes["notificationRoutes<br/>mounted at /v0"]
        errors["errorHandler<br/>replies with RFC 9457 problem+json"]
        utf8 --> validator
        validator --> health & routes
        utf8 & validator & routes -. throws .-> errors
    end

    subgraph core["Service and domain · src/service/, src/domain/"]
        direction TB
        service["NotificationService<br/>create · get · process"]
        recipient["validateRecipient<br/>email · E.164 · push token"]
        transition["assertTransition<br/>queued → sent / failed"]
        service --> recipient & transition
    end

    subgraph ports["Ports · src/ports/"]
        direction LR
        repoPort[["NotificationRepository"]]
        dispatchPort[["Dispatcher"]]
        senderPort[["ChannelSender"]]
    end

    subgraph adapters["Adapters · src/adapters/"]
        direction LR
        repo[("InMemoryNotificationRepository<br/>Map by id")]
        dispatcher["InMemoryDispatcher<br/>FIFO · bounded concurrency · drain()"]
        sender["SimulatedSender<br/>delay · failure rate"]
    end

    client -->|HTTP| utf8
    spec -->|loaded at runtime| validator
    spec -. "openapi-typescript → src/generated/api.d.ts" .-> core
    routes --> service
    service --> repoPort & dispatchPort & senderPort
    repoPort --- repo
    dispatchPort --- dispatcher
    senderPort --- sender
    dispatcher -->|"process(id)"| service
```

## Request and delivery flow

POST returns as soon as the record is saved and its id is queued. Delivery happens afterwards in the dispatcher, and the client polls GET for the outcome.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant H as HTTP layer
    participant S as NotificationService
    participant R as Repository
    participant D as Dispatcher
    participant X as ChannelSender

    C->>H: POST /v0/notifications
    H->>H: UTF-8 checks, OpenAPI validation
    H->>S: create(input)
    S->>S: validateRecipient(channel, recipient)
    S->>R: save(status: queued)
    S->>D: enqueue(id)
    S-->>H: notification
    H-->>C: 202 {id, status: queued}, Location

    Note over D,X: Later, up to WORKER_CONCURRENCY at a time
    D->>S: process(id)
    S->>R: findById(id)
    S->>X: send(notification)
    alt send resolves
        S->>R: updateStatus(id, sent)
    else send throws
        S->>R: updateStatus(id, failed)
    end

    C->>H: GET /v0/notifications/{id}
    H->>S: get(id)
    S->>R: findById(id)
    H-->>C: 200 {id, channel, status}, or 404 problem+json
```

Any validation failure along the POST path (bad charset or bytes, a schema violation, an invalid recipient) skips the rest of the chain and goes to `errorHandler`, which returns problem+json. `process` never throws: a send failure becomes `failed`, and anything unexpected is logged so the dispatcher keeps running.

## Status lifecycle

[`assertTransition`](../src/domain/notification.ts) is the only place transitions are decided. Both end states are terminal; there are no retries.

```mermaid
stateDiagram-v2
    [*] --> queued: POST accepted
    queued --> sent: send resolves
    queued --> failed: send throws
    sent --> [*]
    failed --> [*]
```

## Composition and shutdown

[`src/server.ts`](../src/server.ts) is the composition root. It reads the config, builds one `SimulatedSender` for all three channels, calls `createContainer` to wire the repository, dispatcher and service, and passes the service to `createApp`. The tests use the same `createContainer` with senders that always succeed, always fail, or wait for the test to release them.

On `SIGTERM` or `SIGINT` the server stops accepting connections, waits for in-flight requests, then awaits `dispatcher.drain()` so queued sends finish before the process exits.

## Where real infrastructure would plug in

| Port | Today | Production replacement |
|---|---|---|
| `NotificationRepository` | `Map` in process memory | Postgres or DynamoDB, with an outbox table so saving and enqueueing are atomic |
| `Dispatcher` | In-process FIFO array | Pub/Sub or SQS with at-least-once delivery and idempotent consumers |
| `ChannelSender` | `SimulatedSender` | One adapter per provider (SMTP, SMS gateway, FCM/APNs) with timeouts and circuit breakers |

The service and routes don't change for any of these, because every port is already async.
