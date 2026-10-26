# Production deployment — 26.10.2026

- Release: I-MAX Android/Web 2.7.7
- Application candidate: `210f0b0d`
- Queue contract: persistent idempotent acceptance queue with complete media batches
- Deployment: GitHub Actions `Deploy MAX Service`
- Reason for this marker: retry the failed production workflow for the unchanged, tested release candidate

The deployment must preserve production environment files and is accepted only after the public health check returns `success: true` and `service: ITUS`.
