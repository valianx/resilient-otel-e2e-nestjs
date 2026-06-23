/**
 * Distributed trace propagation across a multi-hop chain (the real use case:
 * ingress → orchestrator → N services). Proves:
 *   1. the incoming W3C `traceparent` trace_id flows to EVERY hop (one trace,
 *      no orphaned "trazas sueltas"), because each hop extracts the inbound
 *      context and injects it on the outbound call;
 *   2. the ingress's sampling DECISION (the -01/-00 flag) is honored by the
 *      ParentBased sampler: sampled=01 → all hops emit spans; sampled=00 → none.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Controller, Get, Headers } from '@nestjs/common';
import { trace, context, propagation } from '@opentelemetry/api';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from './helpers/app.js';
import { waitFor } from './helpers/collector.js';

const SERVICE = 'e2e-propagation';
const TRACE_ID = 'abcdabcdabcdabcdabcdabcdabcdabcd';

const tracer = () => trace.getTracer('e2e');

@Controller()
class ChainController {
  // First hop: behaves like the orchestrator behind the ingress.
  @Get('orchestrator')
  async orchestrator(@Headers() headers: Record<string, string>): Promise<{ ok: boolean }> {
    const parent = propagation.extract(context.active(), headers);
    return context.with(parent, () =>
      tracer().startActiveSpan('orchestrator', async (span) => {
        const out: Record<string, string> = {};
        propagation.inject(context.active(), out); // carry traceparent downstream
        await fetch(`${process.env.SELF_URL}/svc`, { headers: out });
        span.end();
        return { ok: true };
      }),
    );
  }

  // Second hop: a downstream service.
  @Get('svc')
  svc(@Headers() headers: Record<string, string>): { ok: boolean } {
    const parent = propagation.extract(context.active(), headers);
    return context.with(parent, () =>
      tracer().startActiveSpan('svc', (span): { ok: boolean } => {
        span.end();
        return { ok: true };
      }),
    );
  }
}

describe('trace propagation across hops (parent-based sampling honored)', () => {
  let app: { url: string; close: () => Promise<void> };

  before(async () => {
    app = await bootApp(
      { serviceName: SERVICE, scrubber: createScrubber(), samplingRatio: 1.0, ...collectorHttp() },
      [ChainController],
    );
    process.env.SELF_URL = app.url;
  });

  after(async () => {
    await app?.close();
  });

  it('propagates the ingress trace_id to every hop (sampled=01)', async () => {
    const traceparent = `00-${TRACE_ID}-1111111111111111-01`;
    await fetch(`${app.url}/orchestrator`, { headers: { traceparent } });

    const cap = await waitFor(
      SERVICE,
      (c) => c.spans.some((s) => s.name === 'orchestrator') && c.spans.some((s) => s.name === 'svc'),
    );

    const orchestrator = cap.spans.find((s) => s.name === 'orchestrator');
    const svc = cap.spans.find((s) => s.name === 'svc');
    assert.ok(orchestrator, 'orchestrator span exported');
    assert.ok(svc, 'svc span exported');
    // Both hops carry the INGRESS trace_id — one trace, not loose spans.
    assert.equal(orchestrator.traceId, TRACE_ID, 'orchestrator joined the ingress trace');
    assert.equal(svc.traceId, TRACE_ID, 'svc joined the ingress trace');
  });

  it('honors the ingress NOT-sampled decision (sampled=00 → no spans)', async () => {
    const notSampledTrace = '11112222333344445555666677778888';
    const traceparent = `00-${notSampledTrace}-2222222222222222-00`;
    await fetch(`${app.url}/orchestrator`, { headers: { traceparent } });

    // Give any export a chance, then assert NOTHING for this trace was emitted.
    const cap = await waitFor(
      SERVICE,
      (c) => c.spans.some((s) => s.traceId === notSampledTrace),
      6000,
    );
    const leaked = cap.spans.filter((s) => s.traceId === notSampledTrace);
    assert.equal(leaked.length, 0, 'no spans emitted for an unsampled (00) parent trace');
  });
});
