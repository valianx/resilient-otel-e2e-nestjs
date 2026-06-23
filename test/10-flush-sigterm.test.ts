/**
 * Graceful shutdown on SIGTERM (the k8s pod-termination case): telemetry queued
 * before the signal must be FLUSHED before the process exits. We spawn a child
 * that emits then waits, send it SIGTERM (as k8s does), wait for a clean exit,
 * and assert the Collector received the telemetry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { waitFor } from './helpers/collector.js';

const SERVICE = 'e2e-sigterm';

function spawnChildUntilReady(): Promise<{ pid: number; exited: Promise<number> }> {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn('node', [resolve(process.cwd(), 'dist/test/fixtures/sigterm-app.js')], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const exited = new Promise<number>((res) => child.on('exit', (code) => res(code ?? -1)));
    let out = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('READY')) resolveReady({ pid: child.pid!, exited });
    });
    child.on('error', rejectReady);
  });
}

describe('SIGTERM flushes telemetry before exit (k8s graceful shutdown)', () => {
  it('exports the queued span/log after a SIGTERM', async () => {
    const { pid, exited } = await spawnChildUntilReady();

    // k8s sends SIGTERM on pod termination.
    process.kill(pid, 'SIGTERM');
    const code = await exited;
    assert.equal(code, 0, 'child exited cleanly after SIGTERM');

    // The span/log emitted before SIGTERM must have been flushed during shutdown.
    const cap = await waitFor(
      SERVICE,
      (c) => c.spans.some((s) => s.name === 'e2e.work') && c.logs.length > 0,
    );
    assert.ok(cap.spans.some((s) => s.name === 'e2e.work'), 'span flushed on SIGTERM');
    assert.ok(cap.logs.length > 0, 'log flushed on SIGTERM');
  });
});
