import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';
import { WorkController } from './work/work.controller.js';

/**
 * The whole point of the suite: wire the PUBLISHED resilient-otel NestJS adapter
 * exactly as a consumer would, pointing at a real OpenTelemetry Collector. The
 * scrubber is given one extra project-specific denylist term (`custom_secret`)
 * to prove runtime extensibility end-to-end.
 */
@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'resilient-otel-e2e-nestjs',
      scrubber: createScrubber({ extraDenylist: ['custom_secret'] }),
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
      protocol: 'http/protobuf',
      samplingRatio: 1.0,
    }),
  ],
  controllers: [WorkController],
})
export class AppModule {}
