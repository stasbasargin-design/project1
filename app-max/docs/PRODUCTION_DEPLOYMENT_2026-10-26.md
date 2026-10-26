# Production deployment — 26.10.2026

- Release: I-MAX Android/Web 2.7.7
- Application candidate: `210f0b0d`
- Queue contract: persistent idempotent acceptance queue with complete media batches
- Deployment: GitHub Actions `Deploy MAX Service`
- Reason for this marker: retry the failed production workflow for the unchanged, tested release candidate

The deployment must preserve production environment files and is accepted only after the public health check returns `success: true` and `service: ITUS`.

## Android Back/Enter release

- Feature code: `9927b727b9fbbe181e4bce16119c159dcdb0f72a`
- Deployment request: `dc2eae3d8eab408c08c28dd4681346c8f9173df2`
- Release merge: `e2ea4329`
- Verified locally: full `npm test` and static build
- Workflow `40269062306` failed inside the remote deploy command while the public health endpoint remained healthy; the unchanged release is retried by the following documentation commit.
