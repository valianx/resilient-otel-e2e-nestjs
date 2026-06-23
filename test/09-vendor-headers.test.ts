/**
 * Vendor auth headers are actually SENT on export. We stand up a tiny mock
 * OTLP/HTTP receiver, point init() at it with a custom `headers` thunk, emit a
 * span, and assert the receiver saw the Authorization header on /v1/traces.
 * (No Collector needed — this isolates the header-injection path.)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { trace } from '@opentelemetry/api';
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';
import type { ShutdownHandle } from 'resilient-otel';

const TOKEN = 'Bearer VENDOR-TOKEN-123';

describe('vendor headers are sent on OTLP export', () => {
  let server: Server;
  let port: number;
  let handle: ShutdownHandle;
  const seen: Record<string, string | string[] | undefined> = {};

  before(async () => {
    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url?.includes('/v1/traces')) {
          seen.authorization = req.headers['authorization'];
          seen.dataset = req.headers['x-vendor-dataset'];
        }
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/x-protobuf' });
          res.end();
        });
      });
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });

    handle = await init({
      serviceName: 'e2e-vendor-headers',
      scrubber: createScrubber(),
      endpoint: `http://127.0.0.1:${port}`,
      protocol: 'http/protobuf',
      headers: () => ({ Authorization: TOKEN, 'x-vendor-dataset': 'my-ds' }),
    });
  });

  after(async () => {
    await handle?.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('includes the Authorization + dataset headers on the export request', async () => {
    trace.getTracer('e2e').startActiveSpan('vendor.span', (s) => s.end());
    await handle.shutdown(); // force flush → export hits the mock receiver

    assert.equal(seen.authorization, TOKEN, 'Authorization header sent');
    assert.equal(seen.dataset, 'my-ds', 'custom dataset header sent');
  });
});
