# Contributing

## Development setup

Install dependencies:

```bash
npm install
cd receiver && npm install
cd ../worker && npm install
cd ../sender && npm install
cd ..
```

Start local infrastructure:

```bash
podman-compose up -d
```

## Run validation locally

```bash
npm run test:unit
npm run test:integration
npm run test:architecture
npm run test:live
```

## Contribution expectations

Before opening a pull request:

- keep changes focused and minimal
- update docs when behavior changes
- add or update tests for functional changes
- ensure existing tests pass
- avoid committing secrets or local environment files

## Pull request checklist

- [ ] Code builds and runs locally
- [ ] Tests updated or added where appropriate
- [ ] Documentation updated
- [ ] No secrets included
- [ ] Change is scoped and explained clearly

## Architecture note

The supported implementation in this repository is the PostgreSQL + RabbitMQ webhook pipeline. Keep changes aligned with the current `sender -> receiver -> PostgreSQL/outbox -> RabbitMQ -> worker` flow unless the change intentionally removes obsolete code.