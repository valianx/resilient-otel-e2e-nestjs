/**
 * Boot a NestJS app with the resilient-otel adapter configured per scenario.
 * Each scenario passes its own ResilientOtelConfig (unique serviceName) and the
 * controllers it needs, then asserts against the shared collector.
 */
import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import type { ResilientOtelConfig } from 'resilient-otel';

export interface BootedApp {
  url: string;
  close: () => Promise<void>;
}

export async function bootApp(
  config: ResilientOtelConfig,
  controllers: Type[],
  opts: { shutdownHooks?: boolean } = {},
): Promise<BootedApp> {
  @Module({
    imports: [ObservabilityModule.forRoot(config)],
    controllers,
  })
  class ScenarioModule {}

  const app: INestApplication = await NestFactory.create(ScenarioModule, {
    logger: false,
  });
  if (opts.shutdownHooks !== false) app.enableShutdownHooks();
  await app.listen(0);
  const url = await app.getUrl();
  let closed = false;
  return {
    url,
    close: async () => {
      if (closed) return;
      closed = true;
      await app.close();
    },
  };
}

/** Default endpoint/protocol for the local collector (http/protobuf on 4318). */
export function collectorHttp(): Pick<ResilientOtelConfig, 'endpoint' | 'protocol'> {
  return {
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318',
    protocol: 'http/protobuf',
  };
}
