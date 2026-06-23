/**
 * Metrics reach the Collector. createInstruments() builds the standard set;
 * we increment the requests counter, then shutdown (which forces a final metric
 * export) and assert the datapoint arrived.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, Get } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { createInstruments } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { waitFor } from './helpers/collector.js';

const SERVICE = 'e2e-metrics';

@Controller()
class CountController {
  @Get('count')
  count(): { ok: boolean } {
    const { requestsCounter } = createInstruments(metrics.getMeter('e2e'));
    requestsCounter.add(1, { route: '/count' });
    return { ok: true };
  }
}

describe('metrics export', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    app = await bootApp(
      { serviceName: SERVICE, scrubber: createScrubber(), ...collectorHttp() },
      [CountController],
    );
  });

  after(async () => {
    await app?.close();
  });

  it('exports the requests counter datapoint to the Collector', async () => {
    await (await fetch(`${app.url}/count`)).json();
    await app.close(); // forces a final metric export

    const cap = await waitFor(
      SERVICE,
      (c) => c.metrics.some((m) => m.name === 'http.requests.total'),
    );
    assert.ok(
      cap.metrics.some((m) => m.name === 'http.requests.total'),
      'http.requests.total metric exported',
    );
  });
});
