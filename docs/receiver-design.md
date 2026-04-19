# Receiver and Worker Design

## Goal

The template should accept signed webhook requests quickly, persist them durably, and process background work asynchronously through a broker-backed worker pipeline.

## Active processing flow

1. Sender sends `POST /webhook`
2. Receiver captures the raw body
3. Receiver verifies `x-webhook-signature`
4. Receiver validates required fields: `id`, `type`, and `createdAt`
5. Receiver inserts event, job, and outbox rows in PostgreSQL inside one transaction
6. Receiver publishes pending outbox messages to RabbitMQ
7. Receiver returns `202`
8. Worker consumes the RabbitMQ message
9. Worker loads and locks the corresponding job
10. Worker runs business logic for the event type
11. Worker marks the job and event as processed, or retries/dead-letters on failure

## Receiver responsibilities

The receiver in `receiver/index.js` is responsible for:

- HMAC SHA-256 signature verification
- payload validation
- database-backed idempotency using `webhook_events.event_id`
- durable job creation in `job_queue`
- durable outbox creation in `outbox_messages`
- publishing unpublished outbox rows through RabbitMQ
- exposing inspection endpoints:
  - `GET /health`
  - `GET /events`
  - `GET /jobs`

## Worker responsibilities

The worker in `worker/index.js` is responsible for:

- consuming RabbitMQ messages from the configured processing queue
- loading and locking the corresponding job row from PostgreSQL
- marking jobs as `processing`
- running event-type business logic
- marking jobs and events as `processed`
- retrying failed jobs up to `MAX_RETRIES`
- writing exhausted failures to `dead_letters`

## Sample business logic

The template includes intentionally generic sample event handling:

- `sample.event.created`
  - worker logs processing
  - result action: `sample_action_completed`
- `sample.event.failed`
  - worker logs processing
  - result action: `sample_failure_followup_completed`

Unsupported event types are treated as ignored no-op completions:

- worker returns `status: 'ignored'`
- the job is still marked `processed`
- the event is still marked `processed`
- no dead-letter row is created for unsupported types

Replace the sample event names and worker actions with your own domain-specific workflow.

## Why the receiver and worker are separated

The architecture separates ingestion from business processing.

### Ingestion layer

Handled by the receiver:

- authentication and signature verification
- schema validation
- idempotency check
- durable persistence
- outbox publish trigger
- fast HTTP acknowledgment

### Processing layer

Handled by the worker:

- durable background job execution
- retry handling
- dead-letter capture
- asynchronous scaling through multiple worker processes

This separation keeps webhook acknowledgment fast and prevents slow business work from blocking incoming requests.

## Data model summary

### `webhook_events`

Stores received webhook payloads and final event state.

Important fields:

- `event_id`
- `event_type`
- `payload_json`
- `signature`
- `status`
- `received_at`
- `processed_at`

### `job_queue`

Stores durable processing jobs.

Important fields:

- `event_id`
- `job_type`
- `status`
- `attempt_count`
- `max_attempts`
- `last_error`
- `next_retry_at`
- `available_at`
- `created_at`
- `updated_at`

### `outbox_messages`

Stores messages to be published to RabbitMQ.

Important fields:

- `event_id`
- `exchange_name`
- `routing_key`
- `payload_json`
- `published_at`

### `dead_letters`

Stores exhausted failures.

Important fields:

- `event_id`
- `job_id`
- `reason`
- `payload_json`
- `dead_lettered_at`

## RabbitMQ topology

Configured through `shared/config.js` and created by the shared RabbitMQ helper.

Template defaults:

- exchange: `app.events`
- queue: `app.events.processing`
- dead-letter exchange: `app.events.dlx`
- dead-letter queue: `app.events.dead`
- routing key: `app.event.process`

Messages are published persistently, and workers use manual acknowledgments.

## Idempotency model

Idempotency is database-backed.

When the receiver gets a webhook:

- it checks `webhook_events` for the same `event_id`
- if found, it returns `200` with `Duplicate event ignored`
- it does not create a second event row, job row, or outbox row

This works across process restarts and supports multi-instance architecture patterns that share the same database.

## Retry and dead-letter behavior

If worker processing throws:

1. the worker logs the failure
2. if the retry budget is not exhausted:
   - the job is moved back to `queued`
   - `last_error`, `next_retry_at`, and `available_at` are updated
   - the message is requeued
3. if retries are exhausted:
   - the job is marked `dead-lettered`
   - a row is inserted into `dead_letters`
   - the message is acknowledged and not retried again

Retry timing is currently a fixed delay based on `RETRY_DELAY_MS`.

## Concurrency model

Receiver concurrency is normal HTTP server concurrency.

Worker concurrency is broker-driven:

- multiple worker processes can run at the same time
- RabbitMQ distributes messages among them
- each worker uses `WORKER_PREFETCH` to limit in-flight unacknowledged messages

Worker identity can be set with:

```bash
WORKER_ID=worker-1 npm start
```

## Inspection endpoints

### `GET /health`

Returns:

- receiver status
- total event count
- job counts grouped by status

### `GET /events`

Returns recent event rows from `webhook_events`.

### `GET /jobs`

Returns:

- recent job rows from `job_queue`
- recent dead-letter rows from `dead_letters`

## What to customize in downstream projects

When reusing this template, customize at least:

- sender payload fields
- event naming conventions
- worker handler logic
- queue/exchange/routing names
- schema/table layout if required by your domain
- inspection endpoint exposure and auth model

## Known design gaps

This template is production-style, but not fully production-complete.

Current gaps include:

- no dedicated background outbox publisher loop beyond receiver-triggered publish
- no exponential backoff strategy
- no metrics, tracing, or structured logging pipeline
- no auth on inspection endpoints
- no schema validation library beyond basic field checks
- no deployment manifests or migration tooling