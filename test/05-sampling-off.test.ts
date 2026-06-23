/**
 * samplingRatio: 0 drops ROOT spans (no parent decision), but logs are NOT
 * trace-sampled — they still export. Proves the ratio applies to root spans and
 * that logs are independent of the trace sampler. (The ratio: 1.0 case is 01.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { capturedFor, waitFor } from './helpers/collector.js';
import { WorkController } from '../src/work/work.controller.js';

const SERVICE = 'e2e-sampling-off';

describe('sampling ratio 0 — root spans dropped, logs still export', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    app = await bootApp(
      { serviceName: SERVICE, samplingRatio: 0, scrubber: createScrubber(), ...collectorHttp() },
      [WorkController],
    );
  });
  after(async () => {
    await app?.close();
  });

  it('drops the root span but still exports the log', async () => {
    await (await fetch(`${app.url}/work`)).json();
    await app.close();

    // Wait for the log to land, then assert no spans were sampled.
    const cap = await waitFor(SERVICE, (c) => c.logs.length > 0);
    assert.ok(cap.logs.length > 0, 'log exported (not trace-sampled)');
    assert.equal(capturedFor(SERVICE).spans.length, 0, 'no spans sampled at ratio 0');
  });
});
