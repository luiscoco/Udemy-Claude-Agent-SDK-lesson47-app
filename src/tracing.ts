import { trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

const memory = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ "service.name": "lesson47-web-host" }),
  spanProcessors: [new SimpleSpanProcessor(memory)],
});
provider.register();
export async function linkedRun(
  endpoint: string,
  token: string,
  action: () => Promise<void>,
) {
  memory.reset();
  return trace
    .getTracer("lesson47")
    .startActiveSpan("classroom.http.request", async (span) => {
      const ids = span.spanContext();
      try {
        await action();
      } finally {
        span.end();
        await provider.forceFlush();
        const exporter = new OTLPTraceExporter({
          url: endpoint + "/v1/traces",
          headers: { Authorization: `Bearer ${token}` },
        });
        await new Promise<void>((resolve, reject) =>
          exporter.export(memory.getFinishedSpans(), (result) =>
            result.code === 0
              ? resolve()
              : reject(new Error("Host span export failed.")),
          ),
        );
        await exporter.shutdown();
        memory.reset();
      }
      return { traceId: ids.traceId, spanId: ids.spanId };
    });
}
