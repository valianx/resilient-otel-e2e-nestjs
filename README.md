# resilient-otel-e2e-nestjs

End-to-end tests that consume **[`resilient-otel`](https://www.npmjs.com/package/resilient-otel)** (published on npm) from a real NestJS app, exporting to a real **OpenTelemetry Collector**, and assert that:

1. spans + logs actually arrive end-to-end (the SDK pipeline works), and
2. every PII/secret value is **redacted before export**, while safe fields pass through.

This is the proof that the library works as a drop-in for a real consumer — not just that its unit tests pass.

## How it works

```
NestJS app (resilient-otel/nestjs)  ──OTLP/http──▶  OTel Collector  ──file exporter──▶  collector/out/telemetry.json
        GET /work                                                                                  ▲
   emits a custom span + a log                                                          the test reads + asserts
   carrying fake secrets/PII
```

The app (`src/`) wires `ObservabilityModule.forRoot()` exactly as a consumer would. `GET /work` emits a span and a log containing sentinel secrets (a password, an extra denylist term, an Axiom-style token, a span-attribute secret) plus a safe field. The test hits the endpoint, closes the app (which flushes telemetry on the lifecycle hook), then reads what the collector received and asserts redaction.

## Run locally

Requires Docker + pnpm.

```bash
pnpm install
pnpm collector:up     # start the OpenTelemetry Collector
pnpm test:e2e         # boot the app, hit /work, assert redacted telemetry
pnpm collector:down
# or all-in-one:
pnpm test:e2e:full
```

## CI

`.github/workflows/e2e.yml` runs the same flow on every push/PR: install → typecheck against the published `.d.ts` → start the collector via docker compose → run the e2e → tear down.

## What it pins

- Consumes `resilient-otel@^0.1.0` from npm (not a local path) — proves the published artifact.
- Node 22+ (CI runs Node 24), pnpm, NestJS 10.
