/**
 * No-op paths: nothing is exported when disabled.
 *   - config `enabled: false`
 *   - standard `OTEL_SDK_DISABLED=true`
 * Neither starts the SDK, so the controller's span/log are no-ops.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { capturedFor, waitFor } from './helpers/collector.js';
import { WorkController } from '../src/work/work.controller.js';

async function exercise(serviceName: string, app: { url: string; close: () => Promise<void> }) {
  await (await fetch(`${app.url}/work`)).json();
  await app.close();
  // Give any (erroneous) export a chance, then assert nothing landed.
  await waitFor(serviceName, () => false, 4000);
  return capturedFor(serviceName);
}

describe('no-op when disabled', () => {
  const apps: Array<{ close: () => Promise<void> }> = [];
  after(async () => {
    for (const a of apps) await a.close();
    delete process.env.OTEL_SDK_DISABLED;
  });

  it('exports nothing when enabled: false', async () => {
    const SERVICE = 'e2e-noop-disabled';
    const app = await bootApp(
      { serviceName: SERVICE, enabled: false, scrubber: createScrubber(), ...collectorHttp() },
      [WorkController],
    );
    apps.push(app);
    const cap = await exercise(SERVICE, app);
    assert.equal(cap.spans.length, 0, 'no spans');
    assert.equal(cap.logs.length, 0, 'no logs');
    assert.equal(cap.metrics.length, 0, 'no metrics');
  });

  it('exports nothing when OTEL_SDK_DISABLED=true', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const SERVICE = 'e2e-noop-sdkdisabled';
    const app = await bootApp(
      { serviceName: SERVICE, enabled: true, scrubber: createScrubber(), ...collectorHttp() },
      [WorkController],
    );
    apps.push(app);
    const cap = await exercise(SERVICE, app);
    assert.equal(cap.spans.length, 0, 'no spans');
    assert.equal(cap.logs.length, 0, 'no logs');
  });
});
