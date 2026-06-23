/**
 * Scrubber mode 'disabled' short-circuits redaction — secrets pass through RAW.
 * This is the governance counter-test: it proves 'disabled' really disables, so
 * the redaction in the other scenarios is meaningful (not a no-op everywhere).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { waitFor, capturedFor } from './helpers/collector.js';
import { WorkController, SECRETS } from '../src/work/work.controller.js';

const SERVICE = 'e2e-scrub-disabled';

describe("scrubber mode 'disabled' — secrets pass through raw", () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    app = await bootApp(
      {
        serviceName: SERVICE,
        scrubber: createScrubber({ mode: 'disabled', extraDenylist: ['custom_secret'] }),
        ...collectorHttp(),
      },
      [WorkController],
    );
  });
  after(async () => {
    await app?.close();
  });

  it('exports the secret values unredacted when disabled', async () => {
    await (await fetch(`${app.url}/work`)).json();
    await app.close();

    await waitFor(SERVICE, (c) => c.logs.length > 0 && c.spans.length > 0);
    const raw = JSON.stringify(capturedFor(SERVICE));

    assert.ok(raw.includes(SECRETS.password), 'password NOT redacted (disabled)');
    assert.ok(raw.includes(SECRETS.customSecret), 'custom_secret NOT redacted (disabled)');
    assert.ok(!raw.includes('[REDACTED]'), 'no redaction marker when disabled');
  });
});
