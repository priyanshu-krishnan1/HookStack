# Receiver and Worker Design

## Goal

The template should accept signed webhook requests quickly, persist them durably, and process background work asynchronously through a broker-backed worker pipeline.

## Active processing flow

1. A provider sends `POST /webhook`
2. The receiver captures the raw body
3. The receiver selects the configured provider adapter
4. The adapter verifies provider-specific signature headers
5. The adapter normalizes the incoming request into the internal event model
6. The receiver inserts event, job, and outbox rows in PostgreSQL inside one transaction
7. The receiver publishes pending outbox messages to RabbitMQ
8. The receiver returns `202`
9. The worker consumes the RabbitMQ message
10. The worker loads and locks the corresponding job
11. The worker runs business logic for the normalized event type
12. The worker marks the job and event as processed, or retries/dead-letters on failure

## Receiver responsibilities

The receiver in `receiver/index.js` is responsible for:

- raw body capture
- provider adapter selection
- signature verification through the active provider adapter
- database-backed idempotency using `webhook_events.event_id`
- durable job creation in `job_queue`
- durable outbox creation in `outbox_messages`
- publishing unpublished outbox rows through RabbitMQ
- exposing inspection endpoints:
  - `GET /health`
  - `GET /events`
  - `GET /jobs`

## Provider adapter responsibilities

The provider adapter layer in `receiver/providers.js` is responsible for:

- reading provider-specific headers
- validating provider-specific signature formats
- extracting provider delivery identifiers
- mapping external payloads into one internal event shape
- keeping provider-specific parsing out of the main receiver pipeline

This design lets downstream users add a new provider without rewriting the persistence and queueing flow.

## Internal normalized event model

Provider adapters convert inbound requests into one stable internal shape before persistence.

Conceptually, normalized events include:

- `id`
- `type`
- `createdAt`
- optional provider metadata
- raw provider payload nested under `data`

This keeps the database schema and worker flow reusable across providers.

## Built-in providers

### Generic provider

The generic provider expects:

- header: `x-webhook-signature`
- raw HMAC SHA-256 hex digest
- payload fields:
  - `id`
  - `type`
  - `createdAt`

This is useful for custom integrations and for understanding the baseline template flow.

### GitHub provider example

The built-in GitHub example expects:

- header: `x-hub-signature-256`
- header: `x-github-event`
- header: `x-github-delivery`

The GitHub adapter normalizes requests into internal event types such as:

- `github.push`
- `github.pull_request.opened`

For example, a GitHub `push` request becomes an internal event with:

- event ID from `x-github-delivery`
- event type from `x-github-event`
- raw GitHub payload preserved under `data`

## Worker responsibilities

The worker in `worker/index.js` is responsible for:

- consuming RabbitMQ messages from the configured processing queue
- loading and locking the corresponding job row from PostgreSQL
- marking jobs as `processing`
- running normalized event-type business logic
- marking jobs and events as `processed`
- retrying failed jobs up to `MAX_RETRIES`
- writing exhausted failures to `dead_letters`

## Built-in business logic examples

The template includes intentionally simple handlers for both generic and GitHub-style normalized events.

### Generic examples

- `sample.event.created`
  - worker logs processing
  - result action: `sample_action_completed`
- `sample.event.failed`
  - worker logs processing
  - result action: `sample_failure_followup_completed`

### GitHub examples

- `github.push`
  - worker logs repository context
  - result action: `github_push_processed`
- `github.pull_request.*`
  - worker logs pull request context and action
  - result action: `github_pull_request_processed`

Unsupported event types are treated as ignored no-op completions:

- worker returns `status: 'ignored'`
- the job is still marked `processed`
- the event is still marked `processed`
- no dead-letter row is created for unsupported types

## Why the receiver and worker are separated

The architecture separates ingestion from business processing.

### Ingestion layer

Handled by the receiver:

- provider-specific signature handling through adapters
- schema normalization
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

Stores normalized webhook payloads and final event state.

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

- the active provider adapter derives a stable event ID
- the receiver checks `webhook_events` for the same `event_id`
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

## How to add a new provider

When reusing this template, the preferred extension path is:

1. add a new adapter in `receiver/providers.js`
2. normalize the provider request into the internal event shape
3. add matching worker handlers in `worker/index.js`
4. add sender simulation only if useful for local development
5. update tests and docs

## Known design gaps

This template is production-style, but not fully production-complete.

Current gaps include:

- no dedicated background outbox publisher loop beyond receiver-triggered publish
- no exponential backoff strategy
- no metrics, tracing, or structured logging pipeline
- no auth on inspection endpoints
- no schema validation library beyond adapter/basic field checks
- no deployment manifests or migration tooling