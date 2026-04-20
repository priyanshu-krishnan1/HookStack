# Setup and Usage

## Project structure

```text
sender/
  package.json
  index.js
receiver/
  package.json
  index.js
  providers.js
worker/
  package.json
  index.js
shared/
  config.js
  db.js
  rabbitmq.js
  schema.sql
tests/
docs/
  setup.md
  receiver-design.md
  reliability.md
  testing.md
docker-compose.yml
.env.example
README.md
```

## Template architecture

```text
sender/provider -> receiver -> PostgreSQL (webhook_events, job_queue, outbox_messages)
                            -> RabbitMQ -> worker
```

This repository is a reusable webhook processing template. The core durability and worker pipeline stay stable while provider adapters normalize incoming webhook formats into one internal event model.

## Default local endpoints

- Receiver webhook endpoint: `http://localhost:4000/webhook`
- Receiver health endpoint: `http://localhost:4000/health`
- Event inspection endpoint: `http://localhost:4000/events`
- Job inspection endpoint: `http://localhost:4000/jobs`
- RabbitMQ management UI: `http://localhost:15672`

## Default local template settings

- PostgreSQL: `postgresql://app_user:app_password@localhost:5432/app_db`
- RabbitMQ: `amqp://app_user:app_password@localhost:5672`
- RabbitMQ user: `app_user`
- RabbitMQ password: `app_password`
- Shared webhook secret: `change-me`
- Default provider mode: `generic`

## Environment variables

Use `.env.example` as the starting point.

### Shared application settings

- `WEBHOOK_SECRET` shared by sender and receiver
- `WEBHOOK_PROVIDER` provider adapter to use, default `generic`
- `PORT` receiver HTTP port
- `MAX_RETRIES` maximum worker retry attempts per job
- `RETRY_DELAY_MS` fixed retry delay before requeue
- `WORKER_PREFETCH` RabbitMQ consumer prefetch count

### Infrastructure settings

- `DATABASE_URL` PostgreSQL connection string
- `RABBITMQ_URL` RabbitMQ connection string
- `RABBITMQ_EXCHANGE` exchange name
- `RABBITMQ_QUEUE` processing queue name
- `RABBITMQ_DLX` dead-letter exchange name
- `RABBITMQ_DLQ` dead-letter queue name
- `RABBITMQ_ROUTING_KEY` publish routing key

### Sender controls

- `WEBHOOK_URL` destination URL for the sender
- `EVENT_COUNT` number of events to send in one run
- `SENDER_CONCURRENCY` number of concurrent sender requests
- `EVENT_TYPE` event type to send in generic mode, default `sample.event.created`
- `MIXED_EVENT_TYPES=true` alternates example event payloads in the active provider mode

### Worker controls

- `WORKER_ID` optional worker identity for logs

## Initial setup

From the repository root:

```bash
cp .env.example .env
```

Then update values for your project.

## Install dependencies

From the repository root:

```bash
npm install
cd receiver && npm install
cd ../worker && npm install
cd ../sender && npm install
cd ..
```

## Start infrastructure

From the repository root:

```bash
podman-compose up -d
```

This starts PostgreSQL and RabbitMQ locally with the template defaults from `docker-compose.yml`.

## Start receiver

Generic provider mode:

```bash
cd receiver
npm start
```

GitHub provider mode:

```bash
cd receiver
WEBHOOK_PROVIDER=github npm start
```

Expected output:

```text
Receiver listening on http://localhost:4000
```

## Start worker

In another terminal:

```bash
cd worker
npm start
```

Expected output:

```text
[worker] listening for messages
```

## Send a generic sample webhook

In another terminal:

```bash
cd sender
npm start
```

Expected generic receiver behavior:

- verifies `x-webhook-signature`
- inserts rows into `webhook_events`, `job_queue`, and `outbox_messages`
- publishes pending outbox messages to RabbitMQ
- returns `202`

Expected worker behavior:

- consumes the RabbitMQ message
- loads and locks the corresponding job
- processes sample business logic
- marks the job and event as processed

## Send a GitHub-style sample webhook

Start the receiver in GitHub mode, then run:

```bash
cd sender
WEBHOOK_PROVIDER=github npm start
```

Expected GitHub-mode receiver behavior:

- verifies `x-hub-signature-256`
- reads `x-github-event` and `x-github-delivery`
- normalizes the provider request into an internal event such as `github.push`
- inserts normalized event, job, and outbox rows
- returns `202`

Expected worker behavior:

- handles normalized events such as `github.push`
- logs repository context from the normalized payload
- marks the job and event as processed

## Send multiple sample events

Generic burst:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 npm start
```

GitHub burst:

```bash
cd sender
WEBHOOK_PROVIDER=github EVENT_COUNT=10 SENDER_CONCURRENCY=3 npm start
```

GitHub mixed example burst:

```bash
cd sender
WEBHOOK_PROVIDER=github EVENT_COUNT=10 SENDER_CONCURRENCY=3 MIXED_EVENT_TYPES=true npm start
```

Run multiple workers in separate terminals:

```bash
cd worker
WORKER_ID=worker-1 npm start
```

```bash
cd worker
WORKER_ID=worker-2 npm start
```

```bash
cd worker
WORKER_ID=worker-3 npm start
```

RabbitMQ distributes queued messages across available workers.

## Inspect runtime state

Health:

```bash
curl http://localhost:4000/health
```

Events:

```bash
curl http://localhost:4000/events
```

Jobs and dead letters:

```bash
curl http://localhost:4000/jobs
```

## Inspect infrastructure state

Inspect PostgreSQL tables with `psql` or another client:

- `webhook_events`
- `job_queue`
- `dead_letters`
- `outbox_messages`

Inspect RabbitMQ via:

```text
http://localhost:15672
```

## Test invalid signature

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

Expected result:

- sender receives `401`
- receiver rejects the request
- no event/job rows are created for that request

## Request flow summary

1. A provider-specific sender or external service creates a webhook request.
2. The request body is signed using the shared secret.
3. The receiver selects a provider adapter based on `WEBHOOK_PROVIDER`.
4. The adapter validates provider headers and normalizes the payload.
5. The receiver inserts event, job, and outbox rows in PostgreSQL in one transaction.
6. The receiver publishes pending outbox rows to RabbitMQ.
7. The receiver returns `202`.
8. The worker consumes the queued message.
9. The worker updates job and event state in PostgreSQL.

## How to add a new provider

For a new provider, usually add or change:

- `receiver/providers.js`
  - add a new adapter
  - verify the provider’s signature header format
  - normalize the provider payload into the internal event shape:
    - `id`
    - `type`
    - `createdAt`
    - provider metadata
    - raw provider payload inside `data`
- `worker/index.js`
  - add handlers for the normalized event names
- `sender/index.js`
  - optional local simulator for that provider
- tests and docs
  - add a provider-specific live path and usage notes

## Required customization for real projects

Before reusing this template in another project, replace at least:

- placeholder secrets and connection strings in `.env`
- broker naming values in `.env`
- example provider payloads in `sender/index.js`
- example worker logic in `worker/index.js`
- provider normalization rules in `receiver/providers.js` if you are not using the built-in examples
- schema details if your domain requires a different persistence model

## Notes

This template provides:

- database-backed idempotency
- durable event and job state in PostgreSQL
- outbox-backed message publication
- RabbitMQ-based asynchronous processing
- separate worker processes
- retry and dead-letter handling
- multi-worker concurrency through the broker
- provider-adapter based request normalization

Known gaps still remain, such as the lack of a dedicated background outbox publisher loop, metrics/tracing, and migration tooling.