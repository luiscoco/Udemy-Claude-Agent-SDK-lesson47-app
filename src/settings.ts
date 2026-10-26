import type { Mode } from "./protocol.js";
export const FILES = [
  "notes/catalog.txt",
  "notes/orders.txt",
  "notes/billing.txt",
];
export function telemetryEnvironment(
  mode: Mode,
  endpoint: string,
  token: string,
) {
  const enabled = mode !== "off";
  const selected = (signal: string) =>
    enabled &&
    (!["metrics", "logs", "traces"].includes(mode) || mode === signal);
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: enabled ? "1" : "0",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: selected("traces") ? "1" : "0",
    OTEL_TRACES_EXPORTER: selected("traces") ? "otlp" : "none",
    OTEL_METRICS_EXPORTER: selected("metrics") ? "otlp" : "none",
    OTEL_LOGS_EXPORTER: selected("logs") ? "otlp" : "none",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
    OTEL_METRIC_EXPORT_INTERVAL: "1000",
    OTEL_LOGS_EXPORT_INTERVAL: "1000",
    OTEL_TRACES_EXPORT_INTERVAL: "1000",
    OTEL_SERVICE_NAME: "lesson47-classroom-agent",
    OTEL_RESOURCE_ATTRIBUTES: resourceTags(mode),
    OTEL_LOG_USER_PROMPTS: mode === "content" ? "1" : "0",
    OTEL_LOG_TOOL_DETAILS: mode === "content" ? "1" : "0",
    OTEL_LOG_TOOL_CONTENT: mode === "content" ? "1" : "0",
    OTEL_LOG_RAW_API_BODIES: "0",
    CLAUDE_CODE_OTEL_DIAG_STDERR: "1",
    OTEL_METRICS_INCLUDE_ACCOUNT_UUID: "false",
  };
}
export function resourceTags(mode: Mode) {
  const user = mode === "tags" ? "student 47" : "classroom-demo";
  return `service.version=1.0.0,deployment.environment=classroom,enduser.id=${encodeURIComponent(user)},tenant.id=demo-school`;
}
export function inheritedEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("OTEL_") ||
      /^(ENABLE_BETA_TRACING|BETA_TRACING_ENDPOINT|ENABLE_ENHANCED_TELEMETRY_BETA)/.test(
        key,
      )
    )
      delete env[key];
  return env;
}
