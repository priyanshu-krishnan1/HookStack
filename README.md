# Reusable Webhook Processing Template

Reusable Node.js webhook template with:

- signed webhook sender
- Express-based receiver with provider-adapter support
- PostgreSQL-backed durable event, job, and outbox persistence
- RabbitMQ-backed asynchronous worker processing
- automated tests, including live runtime flow validation
- GitHub Actions CI for contribution validation
- GitHub security automation via Dependabot and CodeQL

## Architecture

```text
sender/provider -> receiver -> PostgreSQL (webhook_events, job_queue, outbox_messages)
                            -> RabbitMQ -> worker
```

This repository is intended to be reused as a webhook processing starter template. It supports a provider-adapter pattern so you can keep the core pipeline stable while adding provider-specific normalization for sources such as generic custom webhooks or GitHub webhooks.

## Repository contents

- `sender/` - signed webhook sender with single-event and burst sending support
- `receiver/` - webhook ingress service, provider adapters, and outbox publisher trigger
- `worker/` - background consumer that processes queued jobs
- `shared/` - config, schema, PostgreSQL, and RabbitMQ helpers
- `tests/` - unit, integration, architecture, and live runtime tests
- `docs/` - setup, design, reliability, and testing guides
- `.env.example` - template environment variables
- `.github/workflows/ci.yml` - CI workflow
- `.github/workflows/codeql.yml` - CodeQL code scanning workflow
- `.github/dependabot.yml` - automated dependency update configuration

## Quick start

### 1. Copy the template environment file

```bash
cp .env.example .env
```

Update the values for your environment, especially:

- `WEBHOOK_SECRET`
- `DATABASE_URL`
- `RABBITMQ_URL`
- broker naming values such as exchange, queue, and routing key
- `WEBHOOK_PROVIDER`

### 2. Install dependencies

```bash
npm install
cd receiver && npm install
cd ../worker && npm install
cd ../sender && npm install
cd ..
```

### 3. Start infrastructure

From the repository root:

```bash
podman-compose up -d
```

This starts PostgreSQL and RabbitMQ locally with the template defaults.

### 4. Start the receiver

```bash
cd receiver
npm start
```

Expected log:

```text
Receiver listening on http://localhost:4000
```

### 5. Start one or more workers

Terminal 2:

```bash
cd worker
WORKER_ID=worker-1 npm start
```

Terminal 3:

```bash
cd ../worker
WORKER_ID=worker-2 npm start
```

Each worker process consumes from the same RabbitMQ queue.

### 6. Send sample events

Generic single event:

```bash
cd sender
npm start
```

Generic burst send:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 npm start
```

Generic mixed event types:

```bash
cd sender
EVENT_COUNT=20 SENDER_CONCURRENCY=5 MIXED_EVENT_TYPES=true npm start
```

GitHub-style example:

```bash
cd sender
WEBHOOK_PROVIDER=github npm start
```

GitHub-style mixed example:

```bash
cd sender
WEBHOOK_PROVIDER=github EVENT_COUNT=10 SENDER_CONCURRENCY=3 MIXED_EVENT_TYPES=true npm start
```

## Template defaults

The template supports two provider modes:

- `generic` - internal sample contract using `x-webhook-signature`
- `github` - built-in example adapter using GitHub-style headers and normalized event names

Generic sample event types:

- `sample.event.created`
- `sample.event.failed`

Built-in GitHub normalized event examples:

- `github.push`
- `github.pull_request.opened`

These exist to demonstrate the provider adapter flow. Replace them with your own provider handlers as needed.

## Runtime behavior

- `POST /webhook` selects a provider adapter based on `WEBHOOK_PROVIDER`
- the adapter verifies provider-specific signature headers and normalizes incoming requests into the internal event model
- normalized event/job/outbox rows are persisted in PostgreSQL and published through RabbitMQ
- duplicate event IDs are ignored through database-backed idempotency
- workers consume RabbitMQ messages, lock the corresponding job, run business logic, and update final job/event state
- unsupported event types are marked complete as ignored no-op processing, not dead-lettered
- `/health`, `/events`, and `/jobs` expose runtime inspection data

## How to adapt this template to a new webhook provider

The recommended extension point is the provider adapter layer.

For a new provider, usually change:

- `receiver/providers.js` to add a new adapter that:
  - reads provider-specific headers
  - verifies the provider signature format
  - maps provider payloads into the internal event model
- `worker/index.js` to add handlers for your normalized event names
- `sender/index.js` only if you want a local simulator for that provider
- tests and docs to cover the new provider behavior

For many real integrations, the database schema, queue flow, retry model, and worker runtime can stay unchanged.

## Tests

Run all root-managed test layers:

```bash
npm test
```

Run specific layers:

```bash
npm run test:unit
npm run test:integration
npm run test:architecture
npm run test:live
```

## Documentation

- [Setup and usage](docs/setup.md)
- [Receiver and worker design](docs/receiver-design.md)
- [Reliability model](docs/reliability.md)
- [Testing and validation](docs/testing.md)

## Contribution and community files

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)

## CI

GitHub Actions validates contributions by running:

- unit tests
- integration tests
- architecture tests
- live runtime tests against PostgreSQL + RabbitMQ services

## GitHub security features

This template now includes:

- Dependabot configuration for npm and GitHub Actions dependency update PRs
- CodeQL workflow for automated JavaScript security analysis

After pushing the repository to GitHub, also enable these repository settings for stronger reporting:

- Dependabot alerts
- Dependabot security updates
- secret scanning
- push protection for secrets

These are enabled in GitHub repository settings and are not fully controlled by files in the repository.
