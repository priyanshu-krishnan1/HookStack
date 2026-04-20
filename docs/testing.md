# Testing and Validation

## Automated test layers

This template includes Jest-based unit, integration, architecture, and live runtime tests for a PostgreSQL + RabbitMQ webhook processing pipeline with provider-adapter based ingestion.

### 1. Unit tests

Location:

```text
tests/unit/
```

Coverage includes:

- shared config defaults and env overrides
- schema file structure checks

Run:

```bash
npm install
npm run test:unit
```

### 2. Integration tests

Location:

```text
tests/integration/
```

Coverage focuses on infrastructure-level validation such as compose/service structure and service wiring.

Run:

```bash
npm run test:integration
```

### 3. Architecture tests

Location:

```text
tests/e2e/
```

These are static code-structure assertions. They do not require PostgreSQL or RabbitMQ to be running.

Coverage focuses on architecture and workflow expectations around the receiver, worker, database, and broker flow.

Run:

```bash
npm run test:architecture
```

### 4. Live runtime tests

Location:

```text
tests/live/
```

These tests use real local infrastructure and exercise the actual runtime flow:

1. connect to existing PostgreSQL and RabbitMQ if already available, otherwise start local infrastructure
2. wait for PostgreSQL and RabbitMQ readiness
3. start the receiver and worker in-process
4. send real HTTP webhook requests
5. assert PostgreSQL persistence and processing outcomes

Current live coverage includes:

- accepted generic signed webhook -> persisted event/job/outbox -> processed worker flow
- duplicate webhook idempotency
- invalid signature rejection without persistence
- unsupported event type processed as a no-op completion
- GitHub-style webhook acceptance through the built-in provider adapter

Run:

```bash
npm run test:live
```

## Run all tests

```bash
npm test
```

## Installation prerequisites

Before running tests, install dependencies:

```bash
npm install
cd receiver && npm install
cd ../worker && npm install
cd ../sender && npm install
cd ..
```

Optionally copy the template environment file first:

```bash
cp .env.example .env
```

## Live test prerequisites

Before running live tests, ensure:

- Podman with `podman-compose` or Docker with `docker compose` is installed and available in `PATH`
- ports `4100`, `5432`, `5672`, and `15672` are available if the tests need to start local infrastructure
- the local container runtime is running
- or PostgreSQL and RabbitMQ are already reachable through the configured environment variables

## Manual validation

### Start infrastructure

From the repository root:

```bash
podman-compose up -d
```

### Start receiver and multiple workers

Generic mode, terminal 1:

```bash
cd receiver
npm start
```

GitHub mode, terminal 1:

```bash
cd receiver
WEBHOOK_PROVIDER=github npm start
```

Terminal 2:

```bash
cd worker
WORKER_ID=worker-1 npm start
```

Terminal 3:

```bash
cd worker
WORKER_ID=worker-2 npm start
```

Terminal 4:

```bash
cd worker
WORKER_ID=worker-3 npm start
```

### Verify health and inspection endpoints

```bash
curl http://localhost:4000/health
curl http://localhost:4000/events
curl http://localhost:4000/jobs
```

Expected behavior:

- `/health` returns `status: ok`
- `/events` returns recent event rows
- `/jobs` returns recent job rows and dead letters

### Send a single generic sample event

```bash
cd sender
npm start
```

Validate:

- sender logs a successful delivery
- receiver returns `202`
- worker logs processing and completion
- `/events` shows the event
- `/jobs` shows a processed job

### Send a single GitHub-style sample event

Start the receiver in GitHub mode, then run:

```bash
cd sender
WEBHOOK_PROVIDER=github npm start
```

Validate:

- sender sends `x-github-event`, `x-github-delivery`, and `x-hub-signature-256`
- receiver accepts and normalizes the request
- `/events` stores the normalized type such as `github.push`
- worker logs GitHub-oriented processing
- `/jobs` shows a processed job

### Validate duplicate protection

Temporarily reuse the same delivery ID or event ID in the sender and run twice.

Expected behavior:

- first request is accepted
- second request returns `200`
- second response indicates duplicate handling
- database state still contains one event/job for that event ID

### Validate invalid signature rejection

Generic mode:

```bash
cd sender
WEBHOOK_SECRET=wrongsecret npm start
```

GitHub mode:

```bash
cd sender
WEBHOOK_PROVIDER=github WEBHOOK_SECRET=wrongsecret npm start
```

Expected behavior:

- sender receives `401`
- no new event, job, or outbox rows are created

### Validate unsupported event handling

```bash
cd sender
EVENT_TYPE=sample.event.unknown npm start
```

Expected behavior:

- receiver accepts the event
- worker treats it as ignored/no-op processing
- job still becomes `processed`
- event still becomes `processed`
- no dead-letter row is created only because the event type is unsupported

### Send a burst

Generic burst:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 npm start
```

GitHub burst:

```bash
cd sender
WEBHOOK_PROVIDER=github EVENT_COUNT=20 SENDER_CONCURRENCY=5 npm start
```

Mixed GitHub burst:

```bash
cd sender
WEBHOOK_PROVIDER=github EVENT_COUNT=20 SENDER_CONCURRENCY=5 MIXED_EVENT_TYPES=true npm start
```

Expected burst behavior:

- sender prints per-event delivery logs and a batch summary
- different worker terminals log different `workerId` values
- RabbitMQ distributes messages across workers
- `/health`, `/events`, and `/jobs` reflect progress
- PostgreSQL tables reflect durable state changes

## Inspect durable state directly

Use `psql` or another PostgreSQL client to inspect:

- `webhook_events`
- `job_queue`
- `outbox_messages`
- `dead_letters`

Expected behavior:

- accepted events persist in `webhook_events`
- accepted jobs persist in `job_queue`
- accepted publish intents persist in `outbox_messages`
- exhausted failures, if any, appear in `dead_letters`

## Template customization guidance

Before using this template in another project, update tests and fixtures to match your own:

- provider adapters
- event names
- payload fields
- sender defaults
- worker business logic
- infrastructure credentials and broker names

The bundled tests verify the template defaults, including the built-in generic and GitHub example paths, until you intentionally customize them.

## CI validation

GitHub Actions validates contributions through `.github/workflows/ci.yml`.

Current CI pipeline runs:

- unit tests
- integration tests
- architecture tests
- live runtime tests against PostgreSQL + RabbitMQ service containers

This gives pull requests a contribution gate before merge.

## Important notes

- the live suite can start local infrastructure when needed, but it reuses existing PostgreSQL and RabbitMQ services when they are already available
- the live tests use a dedicated receiver port `4100` to avoid clashing with the default local receiver port
- the live suite truncates application tables between test cases
- the live suite covers both generic and GitHub example flows
- the architecture test layer is static and does not require live infrastructure

## Recommended next improvements

To strengthen runtime confidence further, add live tests for:

- worker retry and dead-letter flow using an intentionally failing business handler
- RabbitMQ outage and outbox recovery behavior
- graceful shutdown during in-flight work
- multi-event burst handling and throughput assertions
- additional provider adapters beyond the bundled GitHub example