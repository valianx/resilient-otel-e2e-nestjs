/**
 * Happy path: a custom span + a log are exported to a real Collector, with
 * PII/secrets redacted before export and the safe field preserved.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { waitFor } from './helpers/collector.js';
import { WorkController, SECRETS, SAFE } from '../src/work/work.controller.js';

const SERVICE = 'e2e-traces-logs';

describe('traces + logs export with redaction', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    app = await bootApp(
      {
        serviceName: SERVICE,
        scrubber: createScrubber({ extraDenylist: ['custom_secret'] }),
        samplingRatio: 1.0,
        ...collectorHttp(),
      },
      [WorkController],
    );
  });

  after(async () => {
    await app?.close();
  });

  it('exports the span + log and redacts PII/secrets, preserving safe fields', async () => {
    const res = await fetch(`${app.url}/work`);
    assert.equal(res.status, 200);
    await res.json();
    await app.close();

    const cap = await waitFor(
      SERVICE,
      (c) => c.spans.some((s) => s.name === 'e2e.work') && c.logs.length > 0,
    );
    const raw = JSON.stringify(cap);

    assert.ok(cap.spans.some((s) => s.name === 'e2e.work'), 'custom span exported');
    assert.ok(raw.includes('work_processed'), 'log exported');
    assert.ok(raw.includes(SAFE.value), 'safe field preserved');
    assert.ok(raw.includes('[REDACTED]'), 'redaction applied');
    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!raw.includes(value), `secret ${name} redacted`);
    }
  });
});
