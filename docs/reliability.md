# Reliability Model

## What is currently handled

The template provides these reliability features:

- database-backed event persistence before returning `202`
- database-backed durable job creation before returning `202`
- outbox row creation in the same transaction as event and job persistence
- database-backed idempotency using unique event IDs
- RabbitMQ durable queueing for asynchronous processing
- worker retry with configurable retry count
- dead-letter recording in PostgreSQL for exhausted failures
- manual message acknowledgments after successful processing
- startup connection retry behavior for RabbitMQ clients
- multi-worker processing through a shared broker queue

## Ingestion durability flow

When a webhook arrives:

1. verify signature
2. validate payload
3. check whether the event already exists in `webhook_events`
4. insert the event row into `webhook_events`
5. insert the job row into `job_queue`
6. insert the outbox row into `outbox_messages`
7. commit the transaction
8. publish pending outbox rows to RabbitMQ
9. return `202`

This means the receiver does not acknowledge accepted processing until the event, job, and outbox records are durable in PostgreSQL.

## Why the outbox matters

A receiver crash can happen after database commit but before broker publish.

The outbox reduces message-loss risk because:

- the receiver stores the intended broker message in `outbox_messages`
- unpublished outbox rows remain in PostgreSQL if publishing does not complete
- startup and request-time publishing both try to flush unpublished outbox rows

Current limitation:

- there is no independent background outbox publisher loop yet
- unpublished rows are retried only when the receiver starts or handles requests and calls `publishOutboxMessages()`

## Job lifecycle states

The active PostgreSQL job states are:

- `queued`
- `processing`
- `processed`
- `dead-lettered`

### queued

The job exists durably and is waiting to be processed.

### processing

A worker has loaded and locked the job and incremented its attempt count.

### processed

Business logic completed successfully, or the event type was intentionally treated as ignored/no-op completion.

### dead-lettered

The retry budget was exhausted and the failure was recorded in `dead_letters`.

## Retry behavior

If worker processing throws:

- the worker logs the failure
- if attempts remain:
  - the job is moved back to `queued`
  - `last_error` is updated
  - `next_retry_at` and `available_at` are updated
  - the RabbitMQ message is requeued
- if attempts are exhausted:
  - the job is marked `dead-lettered`
  - a row is inserted into `dead_letters`
  - the RabbitMQ message is acknowledged and processing stops

The current retry delay is fixed using:

```text
RETRY_DELAY_MS
```

The retry budget is controlled by:

```text
MAX_RETRIES
```

## Idempotency behavior

Idempotency is enforced by the receiver through PostgreSQL.

If the same `event_id` is delivered more than once:

- the existing row in `webhook_events` is detected
- the receiver returns `200`
- the duplicate is ignored
- no second job row or outbox row is created

This is durable across restarts and works with multiple receiver instances sharing the same database.

## Worker acknowledgment model

Workers use manual acknowledgments.

The worker only acknowledges a RabbitMQ message after one of these outcomes:

- the job was completed successfully
- the job was intentionally ignored as unsupported and marked processed
- the job was dead-lettered after exhausting retries

If processing fails and retries remain, the worker issues `nack(..., true)` so the message is requeued.

## Multi-worker reliability model

The system supports multiple worker processes consuming from the same queue.

Reliability properties:

- RabbitMQ distributes messages among workers
- job state remains durable in PostgreSQL
- workers load and lock job state before processing
- already completed or dead-lettered jobs are skipped if a duplicate message is observed

Concurrency is controlled per worker through:

```text
WORKER_PREFETCH
```

Additional processes can be started with unique log identities:

```bash
WORKER_ID=worker-1 npm start
```

## Template defaults

The template ships with generic defaults such as:

- `WEBHOOK_SECRET=change-me`
- `DATABASE_URL=postgresql://app_user:app_password@localhost:5432/app_db`
- `RABBITMQ_URL=amqp://app_user:app_password@localhost:5672`
- exchange: `app.events`
- queue: `app.events.processing`

These are placeholders and should be replaced in real projects.

## Inspection endpoints

### `GET /health`

Returns:

- receiver status
- total event count
- aggregated job counts for:
  - `queued`
  - `processing`
  - `processed`
  - `dead-lettered`

### `GET /events`

Returns recent events from `webhook_events`.

### `GET /jobs`

Returns recent job rows and dead-letter rows.

## Failure scenarios covered

### Duplicate delivery

Handled by database-backed idempotency.

### Receiver crash after database commit but before publish

Partially handled through the outbox table. The durable publish intent remains in PostgreSQL and can be published later.

### Worker crash after message delivery

Handled by manual acknowledgments and durable database state. Unacknowledged messages can be re-delivered.

### RabbitMQ temporarily unavailable during startup

Partially handled by connection retry logic in the shared RabbitMQ client.

### PostgreSQL restart

Durable event and job records remain in PostgreSQL, but application reconnect and recovery behavior is still basic and should be strengthened for real production operation.

## What to harden before production reuse

This template is a strong starting point, but production adopters should still add:

- a dedicated background outbox publisher loop
- exponential backoff or jitter for retries
- poison-message classification beyond retry exhaustion
- authentication on inspection endpoints
- metrics, tracing, and alerting
- formal migration tooling
- stronger readiness checks for all downstream dependencies
- domain-specific schema validation and business error handling

## Practical template guidance

Reuse the structure as-is, but replace:

- secrets
- connection strings
- queue names
- routing keys
- sample event names
- worker logic
- operational controls required by your environment