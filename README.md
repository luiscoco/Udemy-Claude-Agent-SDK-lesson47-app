# Claude Agent SDK · Lesson 47 · Observability with OpenTelemetry

Five student pages, a native OTLP viewer and thirteen source-linked UML code steps.

## What you will learn

- Follow the actual export path: The Agent SDK launches an instrumented CLI. Response messages return through the SDK pipe; OTLP data travels separately to the receiver.
- Select three independent signals: Enable telemetry, then choose metrics, log events and beta traces independently. Compare all signals with metrics-only, logs-only and traces-only experiments.
- Read a native trace tree: Inspect interaction, model-request and Read-tool spans, their durations, parent IDs and trace IDs. The diagram labels host code separately from CLI instrumentation.
- Link an application span: Run query() inside a real active OpenTelemetry host span. Verify the CLI interaction shares its trace ID and references its span ID.
- Tag and filter classroom activity: Set service.name and encoded resource attributes. Filter actual tool-result events by the fictional enduser.id, without exposing account identity.
- Verify delivery and control content: Compare default telemetry with explicit synthetic prompt/tool-content logging. Observe a deliberately rejected endpoint and an agent that still finishes. Short export intervals help short calls but cannot guarantee delivery.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson47-app.git
cd .\Udemy-Claude-Agent-SDK-lesson47-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations: `cd .\agent-sdk\lesson47-opentelemetry`. Open http://127.0.0.1:3147. Node 24+, API credit and Windows Git Bash if needed.

## Create your .env file

Copy the template once and enter your own model key privately. Restart after edits. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3147
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe
```

Local receiver authentication is generated per run. No hosted collector token, GitHub token or Managed Agents IDs are needed.

## Run the experiments

### Compare the three signals

Run All, Metrics, Logs and Traces separately. The UI displays exactly what arrived. Metrics may export several delta batches: rows are points, not unique metric names or a session total.

```powershell
npm run sample:env -- all
npm run sample:env -- metrics
npm run sample:env -- logs
npm run sample:env -- traces
```

### Link and attribute

Linked creates an actual active host span and exports it through the official OTLP exporter. Tags attaches the fictional student 47 identity. Filter the event table by that exact value.

```powershell
npm run sample:env -- linked
npm run sample:env -- tags
```

### Inspect content and failure

Content opts in only for disposable fictional notes. Off disables CLI export. Rejected endpoint returns a real HTTP 503: compare successful SDK completion with receiver rejection records and stderr diagnostics.

```powershell
npm run sample:env -- content
npm run sample:env -- off
npm run sample:env -- unreachable
npm test
```

## How the app was built

### 1. Validate the selected experiment

Accept a fixed experiment only. Browser input cannot choose an arbitrary telemetry destination or add tools.

Source: `src/protocol.ts`, selected lines 16–22. Surrounding code omitted.

```typescript
if (
    !input ||
    Object.keys(input).some((k) => k !== "mode") ||
    !MODES.includes(input.mode)
  )
    throw new Error("Choose a listed telemetry experiment.");
  return { mode: input.mode };
```

### 2. Start the local OTLP receiver

Bind a private loopback port chosen by the OS. The classroom receiver keeps bounded per-run data in memory; it is not a production Collector distribution.

Source: `src/collector.ts`, selected lines 147–151. Surrounding code omitted.

```typescript
server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Collector could not start.");
```

### 3. Enable the selected signals

Select OTLP exporters for each signal and enable beta tracing where needed. Off explicitly disables telemetry.

Source: `src/settings.ts`, selected lines 17–21. Surrounding code omitted.

```typescript
CLAUDE_CODE_ENABLE_TELEMETRY: enabled ? "1" : "0",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: selected("traces") ? "1" : "0",
    OTEL_TRACES_EXPORTER: selected("traces") ? "otlp" : "none",
    OTEL_METRICS_EXPORTER: selected("metrics") ? "otlp" : "none",
    OTEL_LOGS_EXPORTER: selected("logs") ? "otlp" : "none",
```

### 4. Configure OTLP and short intervals

Use standard OTLP HTTP/JSON for inspectable native exports. The lesson slide uses HTTP/protobuf, another supported encoding. One-second intervals reduce short-run batching windows.

Source: `src/settings.ts`, selected lines 22–27. Surrounding code omitted.

```typescript
OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
    OTEL_METRIC_EXPORT_INTERVAL: "1000",
    OTEL_LOGS_EXPORT_INTERVAL: "1000",
    OTEL_TRACES_EXPORT_INTERVAL: "1000",
```

### 5. Preserve the private process environment

Preserve PATH and private credentials while replacing inherited exporter routing with this per-run local configuration. Isolate SDK state in the disposable workspace.

Source: `src/agent.ts`, selected lines 64–67. Surrounding code omitted.

```typescript
env: {
        ...inheritedEnvironment(),
        ...otel,
        HOME: workspace.home,
```

### 6. Create an active application span

Linked mode enters an actual active OpenTelemetry span before query(). The SDK automatically injects its W3C context into the CLI.

Source: `src/tracing.ts`, selected lines 22–28. Surrounding code omitted.

```typescript
return trace
    .getTracer("lesson47")
    .startActiveSpan("classroom.http.request", async (span) => {
      const ids = span.spanContext();
      try {
        await action();
      } finally {
```

### 7. Run query and consume native messages

The regular SDK response stream stays separate from OTLP exports. Only the disposable Read task is available.

Source: `src/agent.ts`, selected lines 122–126. Surrounding code omitted.

```typescript
for await (const message of query({ prompt: PROMPTS[c.mode], options })) {
        if (message.type === "system" && message.subtype === "init")
          observe("sdk-init", {
            sessionId: message.session_id,
            model: message.model,
```

### 8. Receive and decode native OTLP

Parse actual JSON batches received over HTTP, sanitize account identity, then flatten each signal without inventing spans or metrics.

Source: `src/collector.ts`, selected lines 132–136. Surrounding code omitted.

```typescript
const payload = sanitize(JSON.parse(body.toString("utf8")));
      const signal = match[1] as "traces" | "metrics" | "logs";
      data[signal].push(...flatten(signal, payload));
      data.requests.push({
        path: req.url,
```

### 9. Retain span IDs and resource tags

Preserve native parent links and resource attributes. The browser derives its tree from those IDs. Hook spans require separate detailed beta tracing, which this app does not enable.

Source: `src/collector.ts`, selected lines 51–60. Surrounding code omitted.

```typescript
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
```

### 10. Export the finished host span

Export the real host span through the official OpenTelemetry exporter to the same receiver. Verify matching trace and parent IDs in Linked mode.

Source: `src/tracing.ts`, selected lines 31–34. Surrounding code omitted.

```typescript
const exporter = new OTLPTraceExporter({
          url: endpoint + "/v1/traces",
          headers: { Authorization: `Bearer ${token}` },
        });
```

### 11. Attach encoded classroom attributes

Use a fictional classroom identity and percent-encode its space in OTEL_RESOURCE_ATTRIBUTES. The decoded enduser.id can filter tool-result events.

Source: `src/settings.ts`, selected lines 39–41. Surrounding code omitted.

```typescript
const user = mode === "tags" ? "student 47" : "classroom-demo";
  return `service.version=1.0.0,deployment.environment=classroom,enduser.id=${encodeURIComponent(user)},tenant.id=demo-school`;
}
```

### 12. Make content logging explicit

Content mode opts in to synthetic prompt, tool details and tool output. Raw API bodies remain disabled. Default structural telemetry can still contain identifiers; the receiver sanitizes account attributes.

Source: `src/settings.ts`, selected lines 30–34. Surrounding code omitted.

```typescript
OTEL_LOG_USER_PROMPTS: mode === "content" ? "1" : "0",
    OTEL_LOG_TOOL_DETAILS: mode === "content" ? "1" : "0",
    OTEL_LOG_TOOL_CONTENT: mode === "content" ? "1" : "0",
    OTEL_LOG_RAW_API_BODIES: "0",
    CLAUDE_CODE_OTEL_DIAG_STDERR: "1",
```

### 13. Compare delivery with agent completion

Keep receiver requests, diagnostics and SDK results as independent evidence. A successful agent response does not prove telemetry was accepted; the rejected-endpoint mode demonstrates this.

Source: `src/agent.ts`, selected lines 154–159. Surrounding code omitted.

```typescript
const data = receiver.snapshot();
    const after = await workspace.snapshot();
    const evidence = {
      mode: c.mode,
      results,
      telemetry: data,
```

## Reference topics and limits

- Classroom receiver versus production collector: The included receiver accepts actual OTLP HTTP/JSON exports into memory and closes after each run. It does not provide durable storage, retries, a production collector pipeline or a hosted tracing service. Use an OpenTelemetry Collector and your chosen backend for production.
- Traces are beta: The pinned runtime currently emits interaction, llm_request and tool spans. Span names and attributes may change. Native hook spans require additional detailed beta tracing settings and an endpoint override; the normal PreToolUse callback is not presented as a hook span.
- The response channel stays separate: Do not use the console exporter through the SDK, because it writes into the SDK message channel. This sample receives native telemetry over a separate HTTP endpoint.
- Trace context is actual: Linked mode uses a registered NodeTracerProvider, an active span and the official HTTP trace exporter. No trace IDs or parent IDs are fabricated. Only this experiment creates a host span; the other trace experiments show CLI roots.
- Metrics are points, not a bill: The table shows raw native metric points, attributes and aggregation temporality. Repeated exports are not automatically summed. Native cost metrics are estimates, not an invoice. The app does not query organization billing.
- Privacy and opt-in content: Only a fictional disposable note is available to Read. Content logging is off by default and enabled only in the labelled Content experiment. Even structural telemetry can carry session or user identifiers. The classroom receiver redacts account user/organization attributes and the current API credential before UI storage. This is not a comprehensive production DLP solution.
- Diagnose failure: Rejected endpoint uses a live authenticated receiver path returning HTTP 503. It records rejections, accepts no telemetry for that path, and captures exporter diagnostics through the SDK stderr option. This is a deliberate HTTP rejection rather than an invented network outage.
- Short-lived exporters: One-second metrics, log and trace intervals help exports arrive while the task is running. Clean process shutdown tries to flush but cannot guarantee delivery, and killed processes can lose buffered data.
- Per-user filtering: Tags uses enduser.id=student%2047 and tenant.id=demo-school. The native resource contains the decoded value student 47. These are synthetic teaching identities, not the API account owner.
- Primary references: https://code.claude.com/docs/en/agent-sdk/observability · https://code.claude.com/docs/en/monitoring-usage · https://opentelemetry.io/docs/languages/js/exporters/

## Validation

Run `npm test` and `npm run build:client`. Regenerate pages with `python scripts/build-pages.py`. Secrets, dependencies, recordings and teaching media are excluded from Git.
