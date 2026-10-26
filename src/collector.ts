import { createServer } from "node:http";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";

export function decodeValue(v: any): any {
  if (!v) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(decodeValue);
  if (v.kvlistValue) return attributes(v.kvlistValue.values);
  return v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? null;
}
export function attributes(items: any[] = []) {
  return Object.fromEntries(items.map((a) => [a.key, decodeValue(a.value)]));
}
export function sanitize(value: any): any {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    if (/^(user\.|organization\.)/.test(value.key || ""))
      return { key: value.key, value: { stringValue: "[IDENTITY REDACTED]" } };
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v)]),
    );
  }
  if (typeof value === "string") {
    for (const secret of [
      process.env.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_AUTH_TOKEN,
    ].filter(Boolean) as string[])
      value = value.split(secret).join("[REDACTED]");
    return value.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]");
  }
  return value;
}
export function flatten(signal: string, payload: any) {
  const rows: any[] = [];
  const resourceKey =
    signal === "traces"
      ? "resourceSpans"
      : signal === "metrics"
        ? "resourceMetrics"
        : "resourceLogs";
  const scopeKey =
    signal === "traces"
      ? "scopeSpans"
      : signal === "metrics"
        ? "scopeMetrics"
        : "scopeLogs";
  for (const resource of payload[resourceKey] || []) {
    const tags = attributes(resource.resource?.attributes);
    for (const scope of resource[scopeKey] || []) {
      if (signal === "traces")
        for (const span of scope.spans || [])
          rows.push({
            ...span,
            resource: tags,
            attributes: attributes(span.attributes),
            events: (span.events || []).map((e: any) => ({
              ...e,
              attributes: attributes(e.attributes),
            })),
          });
      if (signal === "logs")
        for (const log of scope.logRecords || [])
          rows.push({
            ...log,
            resource: tags,
            attributes: attributes(log.attributes),
            body: decodeValue(log.body),
          });
      if (signal === "metrics")
        for (const metric of scope.metrics || []) {
          const data =
            metric.sum ||
            metric.gauge ||
            metric.histogram ||
            metric.exponentialHistogram ||
            {};
          for (const point of data.dataPoints || [])
            rows.push({
              name: metric.name,
              unit: metric.unit,
              temporality: data.aggregationTemporality,
              monotonic: data.isMonotonic,
              ...point,
              resource: tags,
              attributes: attributes(point.attributes),
            });
        }
    }
  }
  return rows;
}
export async function startCollector(onChange: (data: any) => void) {
  const token = randomBytes(24).toString("hex");
  const data = {
    traces: [] as any[],
    metrics: [] as any[],
    logs: [] as any[],
    requests: [] as any[],
  };
  function snapshot() {
    return structuredClone(data);
  }
  const server = createServer(async (req, res) => {
    const match = /^\/v1\/(traces|metrics|logs)$/.exec(req.url || "");
    if (
      req.method !== "POST" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.writeHead(403).end();
      return;
    }
    if (!match) {
      data.requests.push({ path: req.url, status: 503 });
      onChange(snapshot());
      res.writeHead(503).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error("Telemetry batch too large.");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      const body =
        req.headers["content-encoding"] === "gzip"
          ? gunzipSync(raw, { maxOutputLength: 2_000_000 })
          : raw;
      const payload = sanitize(JSON.parse(body.toString("utf8")));
      const signal = match[1] as "traces" | "metrics" | "logs";
      data[signal].push(...flatten(signal, payload));
      data.requests.push({
        path: req.url,
        status: 200,
        bytes: body.length,
        signal,
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
      onChange(snapshot());
    } catch {
      res.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Collector could not start.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    snapshot,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
