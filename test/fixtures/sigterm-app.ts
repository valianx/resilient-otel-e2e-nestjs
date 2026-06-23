/**
 * Child process for the SIGTERM-flush test (the k8s pod-termination case).
 * Boots the NestJS app (enableShutdownHooks), emits a span + log, prints READY,
 * then waits. On SIGTERM, Nest runs the observability lifecycle → flush → exit.
 * If the flush did NOT happen, the queued telemetry would be lost on exit.
 */
import 'reflect-metadata';
import { createScrubber } from 'resilient-otel/scrub';
import { bootApp, collectorHttp } from '../helpers/app.js';
import { WorkController } from '../../src/work/work.controller.js';

async function main(): Promise<void> {
  // Own the SIGTERM handling deterministically (no Nest auto-hook race): on the
  // signal, close the app — which runs the observability lifecycle → flush —
  // then exit 0. This mirrors a k8s preStop/SIGTERM graceful shutdown.
  const app = await bootApp(
    { serviceName: 'e2e-sigterm', scrubber: createScrubber(), ...collectorHttp() },
    [WorkController],
    { shutdownHooks: false },
  );
  process.on('SIGTERM', () => {
    void app.close().then(() => process.exit(0));
  });
  // Emit a span + log; they sit in the batch queue until flushed on shutdown.
  await (await fetch(`${app.url}/work`)).json();
  // Signal readiness; the http server keeps the process alive until SIGTERM.
  console.log('READY');
}

void main();
