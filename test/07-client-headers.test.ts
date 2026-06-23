/**
 * Incoming client headers governance: when request headers are logged, sensitive
 * ones (authorization, cookie, x-api-key) are redacted while operational ones
 * (cache-control) pass through — using the scrubber's header denylist.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, Get, Headers } from '@nestjs/common';
import { emitLog, Operation, Target, taxonomyAttrs } from 'resilient-otel';
import { createScrubber, type Scrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { waitFor, capturedFor } from './helpers/collector.js';

const SERVICE = 'e2e-client-headers';
const AUTH_SECRET = 'Bearer CLIENT-HEADER-SECRET-XYZ';
const CACHE_VALUE = 'no-cache, max-age=0';

let scrubber: Scrubber;

@Controller()
class EchoController {
  @Get('echo')
  echo(@Headers() headers: Record<string, string>): { ok: boolean } {
    emitLog('info', {
      msg: 'request_received',
      ...taxonomyAttrs(Operation.Request, Target.Client),
      headers: scrubber.scrubAttrs({ ...headers }),
    });
    return { ok: true };
  }
}

describe('incoming client headers — sensitive redacted, operational kept', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    scrubber = createScrubber();
    app = await bootApp(
      { serviceName: SERVICE, scrubber, ...collectorHttp() },
      [EchoController],
    );
  });
  after(async () => {
    await app?.close();
  });

  it('redacts authorization but keeps cache-control', async () => {
    await fetch(`${app.url}/echo`, {
      headers: { authorization: AUTH_SECRET, 'cache-control': CACHE_VALUE },
    });
    await app.close();

    await waitFor(SERVICE, (c) => c.logs.some((l) => l.body?.stringValue === 'request_received'));
    const raw = JSON.stringify(capturedFor(SERVICE));

    assert.ok(raw.includes(CACHE_VALUE), 'cache-control preserved');
    assert.ok(!raw.includes('CLIENT-HEADER-SECRET-XYZ'), 'authorization value redacted');
    assert.ok(raw.includes('[REDACTED]'), 'redaction marker present');
  });
});
