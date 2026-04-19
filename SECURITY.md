# Security Policy

## Reporting a vulnerability

If you discover a security issue, do not open a public GitHub issue with exploit details.

Instead, report it privately to the repository maintainer with:

- affected component
- reproduction steps
- impact summary
- suggested mitigation if known

## Scope

Security-sensitive areas in this repository include:

- webhook signature verification
- PostgreSQL persistence and duplicate handling
- RabbitMQ message delivery and worker processing
- environment variable and secret handling

## Supported usage

This repository is primarily an educational/reference implementation.
Use additional hardening before deploying in a production environment.

## GitHub security features

This repository includes:
- Dependabot update configuration in `.github/dependabot.yml`
- CodeQL code scanning workflow in `.github/workflows/codeql.yml`

After pushing to GitHub, enable the following repository or organization settings where available:
- Dependabot alerts
- Dependabot security updates
- secret scanning
- push protection for secrets

These settings are configured in GitHub and may depend on repository visibility and plan features.

## Disclosure expectations

Please allow reasonable time for validation and remediation before public disclosure.