# Setup and Usage

## Project structure

```text
sender/
  package.json
  index.js
receiver/
  package.json
  index.js
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
sender -> receiver -> PostgreSQL (webhook_events, job_queue, outbox_messages)
                      -> RabbitMQ -> worker
```

This repository is a reusable webhook processing template. The included event names, payload fields, and worker actions are intentionally generic samples that should be replaced in downstream projects.

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

## Environment variables

Use `.env.example` as the starting point.

### Shared application settings

- `WEBHOOK_SECRET` shared by sender and receiver
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
- `EVENT_TYPE` event type to send, default `sample.event.created`
- `MIXED_EVENT_TYPES=true` alternates between `sample.event.created` and `sample.event.failed`

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

```bash
cd receiver
npm start
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

## Send a sample webhook

In another terminal:

```bash
cd sender
npm start
```

Expected sender output includes:

```text
[sender] delivered
[sender] batch complete
```

Expected receiver behavior:

- verifies `x-webhook-signature`
- inserts rows into `webhook_events`, `job_queue`, and `outbox_messages`
- publishes pending outbox messages to RabbitMQ
- returns `202`

Expected worker behavior:

- consumes the RabbitMQ message
- loads and locks the corresponding job
- processes sample business logic
- marks the job and event as processed

## Send multiple sample events

Burst send:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 npm start
```

Mixed event types:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 MIXED_EVENT_TYPES=true npm start
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

```bash
cd sender
WEBHOOK_SECRET=wrongsecret npm start
```

Expected result:

- sender receives `401`
- receiver rejects the request
- no event/job rows are created for that request

## Request flow summary

1. Sender creates a JSON event payload.
2. Sender signs the raw JSON body using HMAC SHA-256.
3. Sender sends `x-webhook-signature`.
4. Receiver verifies the signature.
5. Receiver validates required fields.
6. Receiver inserts event, job, and outbox rows in PostgreSQL in one transaction.
7. Receiver publishes pending outbox rows to RabbitMQ.
8. Receiver returns `202`.
9. Worker consumes the queued message.
10. Worker updates job and event state in PostgreSQL.

## Required customization for real projects

Before reusing this template in another project, replace at least:

- sample event names in `sender/index.js` and `worker/index.js`
- sample payload fields in `sender/index.js`
- worker business logic in `worker/index.js`
- secrets and connection strings in `.env`
- RabbitMQ naming values in `.env`
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

Known gaps still remain, such as the lack of a dedicated background outbox publisher loop, metrics/tracing, and migration tooling.