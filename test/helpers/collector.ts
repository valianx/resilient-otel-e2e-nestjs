/**
 * Helpers to read what the shared OpenTelemetry Collector received.
 *
 * The collector's file exporter appends JSON lines to telemetry.json. Every
 * scenario uses a UNIQUE service.name so it can filter the accumulating file to
 * its own data. Each line is an OTLP ExportRequest (resourceSpans/Logs/Metrics).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const OUT =
  process.env.COLLECTOR_OUT ?? resolve(process.cwd(), 'collector/out/telemetry.json');

function lines(): unknown[] {
  if (!existsSync(OUT)) return [];
  return readFileSync(OUT, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as unknown[];
}

function attrString(attrs: any[] | undefined, key: string): string | undefined {
  const a = (attrs ?? []).find((x) => x.key === key);
  return a?.value?.stringValue;
}

function resourceServiceName(resource: any): string | undefined {
  return attrString(resource?.attributes, 'service.name');
}

export interface Captured {
  spans: any[];
  logs: any[];
  metrics: any[];
  /** Resource attributes of the first matching resource block. */
  resourceAttrs: Record<string, string>;
}

/** Collect all spans/logs/metrics emitted under a given service.name. */
export function capturedFor(serviceName: string): Captured {
  const out: Captured = { spans: [], logs: [], metrics: [], resourceAttrs: {} };
  for (const req of lines() as any[]) {
    for (const rs of req.resourceSpans ?? []) {
      if (resourceServiceName(rs.resource) !== serviceName) continue;
      for (const a of rs.resource?.attributes ?? []) {
        if (a.value?.stringValue) out.resourceAttrs[a.key] = a.value.stringValue;
      }
      for (const ss of rs.scopeSpans ?? []) out.spans.push(...(ss.spans ?? []));
    }
    for (const rl of req.resourceLogs ?? []) {
      if (resourceServiceName(rl.resource) !== serviceName) continue;
      for (const a of rl.resource?.attributes ?? []) {
        if (a.value?.stringValue) out.resourceAttrs[a.key] = a.value.stringValue;
      }
      for (const sl of rl.scopeLogs ?? []) out.logs.push(...(sl.logRecords ?? []));
    }
    for (const rm of req.resourceMetrics ?? []) {
      if (resourceServiceName(rm.resource) !== serviceName) continue;
      for (const sm of rm.scopeMetrics ?? []) out.metrics.push(...(sm.metrics ?? []));
    }
  }
  return out;
}

/** Poll until `predicate(captured)` holds or the timeout elapses. */
export async function waitFor(
  serviceName: string,
  predicate: (c: Captured) => boolean,
  timeoutMs = 20000,
): Promise<Captured> {
  const start = Date.now();
  let last = capturedFor(serviceName);
  while (Date.now() - start < timeoutMs) {
    last = capturedFor(serviceName);
    if (predicate(last)) return last;
    await sleep(250);
  }
  return last;
}

/** Read a log record attribute as a string. */
export function logAttr(log: any, key: string): string | undefined {
  return attrString(log?.attributes, key);
}

/** Read a span attribute as a string. */
export function spanAttr(span: any, key: string): string | undefined {
  return attrString(span?.attributes, key);
}

/** True if the raw telemetry for a service contains a substring anywhere. */
export function rawFor(serviceName: string): string {
  const c = capturedFor(serviceName);
  return JSON.stringify(c);
}
