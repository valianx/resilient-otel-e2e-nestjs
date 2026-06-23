/**
 * End-to-end test on plain Node (no jest VM — the OTel SDK's dynamic imports
 * fail inside jest's vm context). Boots the NestJS app consuming the PUBLISHED
 * resilient-otel against a real OpenTelemetry Collector, hits /work, flushes on
 * close, then asserts the span + log arrived with PII/secrets redacted.
 *
 * Compiled by tsc (which emits the decorator metadata NestJS DI needs) and run
 * as `node dist/test/run-e2e.js`.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { SECRETS, SAFE } from '../src/work/work.controller.js';

const OUT =
  process.env.COLLECTOR_OUT ?? resolve(process.cwd(), 'collector/out/telemetry.json');

async function waitForTelemetry(): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const raw = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (raw.includes('e2e.work') && raw.includes('work_processed')) return raw;
    await sleep(250);
  }
  return existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  await app.listen(0);
  const baseURL = await app.getUrl();

  const res = await fetch(`${baseURL}/work`);
  assert.equal(res.status, 200, 'GET /work returns 200');
  await res.json();

  // Closing the app runs the observability lifecycle → force-flush to collector.
  await app.close();

  const raw = await waitForTelemetry();

  // 1. Telemetry arrived end-to-end.
  assert.ok(raw.includes('e2e.work'), 'custom span "e2e.work" exported');
  assert.ok(raw.includes('work_processed'), 'log "work_processed" exported');
  assert.ok(
    raw.includes('resilient-otel-e2e-nestjs'),
    'service.name resource attribute present',
  );

  // 2. Safe fields preserved.
  assert.ok(raw.includes(SAFE.key), `safe field "${SAFE.key}" preserved`);
  assert.ok(raw.includes(SAFE.value), `safe value "${SAFE.value}" preserved`);

  // 3. Secrets/PII redacted BEFORE export — the raw values must not appear.
  assert.ok(raw.includes('[REDACTED]'), 'redaction marker present');
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!raw.includes(value), `secret "${name}" (${value}) was redacted`);
  }

  console.log('✅ E2E PASSED: telemetry exported to the collector and PII/secrets redacted.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ E2E FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
