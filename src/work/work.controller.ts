import { Controller, Get } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

/** Sentinel values the test asserts are redacted (or preserved) on the wire. */
export const SECRETS = {
  password: 'SECRET-E2E-123', // built-in PII denylist
  customSecret: 'CUSTOM-E2E-456', // extra denylist term from createScrubber
  axiomToken: 'xaat-0123456789abcdef0123456789abcdef0123', // secret-regex bank
  spanSecret: 'SPAN-SECRET-999', // redacted on a span attribute
};
export const SAFE = { key: 'order_id', value: 'ok-789' };

@Controller('work')
export class WorkController {
  @Get()
  run(): { ok: boolean } {
    const tracer = trace.getTracer('e2e');
    return tracer.startActiveSpan('e2e.work', (span): { ok: boolean } => {
      // A log carrying PII/secrets — the scrubber must redact before export.
      emitLog('info', {
        msg: 'work_processed',
        ...taxonomyAttrs(Operation.Response, Target.Client),
        password: SECRETS.password,
        custom_secret: SECRETS.customSecret,
        body: `auth token ${SECRETS.axiomToken}`,
        [SAFE.key]: SAFE.value,
      });
      // A span attribute carrying a secret — redacted by the ScrubSpanProcessor.
      span.setAttribute('password', SECRETS.spanSecret);
      span.setAttribute(SAFE.key, SAFE.value);
      span.end();
      return { ok: true };
    });
  }
}
