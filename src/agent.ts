import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { prepareWorkspace } from "./workspace.js";
import { startCollector, sanitize } from "./collector.js";
import { telemetryEnvironment, inheritedEnvironment } from "./settings.js";
import { linkedRun } from "./tracing.js";
import {
  MODES,
  validateConfig,
  type RunConfig,
  type LabEvent,
  type Mode,
} from "./protocol.js";
import { resolve } from "node:path";
export { MODES, validateConfig };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = { mode: "all" };
export const PROMPTS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    "CLASSROOM-PROMPT-47: Read notes/orders.txt once and report the policy and classroom code in one sentence.",
  ]),
) as Record<Mode, string>;

export async function runAgent(
  value: RunConfig,
  emit: (event: LabEvent) => void,
  controller = new AbortController(),
) {
  const c = validateConfig(value),
    workspace = await prepareWorkspace();
  const before = await workspace.snapshot(),
    observations: any[] = [],
    results: any[] = [],
    diagnostics: string[] = [];
  const observe = (kind: string, detail: any) => {
    const row = { kind, detail: sanitize(detail) };
    observations.push(row);
    emit({ type: "observation", observation: row });
  };
  const receiver = await startCollector((data) =>
    emit({ type: "telemetry", data }),
  );
  const endpoint =
    receiver.endpoint + (c.mode === "unreachable" ? "/unavailable" : "");
  const otel = telemetryEnvironment(c.mode, endpoint, receiver.token);
  const publicSettings = {
    ...otel,
    OTEL_EXPORTER_OTLP_HEADERS: "[EPHEMERAL LOCAL RECEIVER AUTH]",
  };
  let host: any = null;
  try {
    const options: Options = {
      model: MODEL,
      cwd: workspace.cwd,
      tools: ["Read"],
      allowedTools: ["Read"],
      permissionMode: "dontAsk",
      settingSources: [],
      maxTurns: 4,
      maxBudgetUsd: 0.3,
      effort: "low",
      thinking: { type: "disabled" },
      abortController: controller,
      env: {
        ...inheritedEnvironment(),
        ...otel,
        HOME: workspace.home,
        USERPROFILE: workspace.home,
        CLAUDE_CONFIG_DIR: workspace.sdkHome,
      },
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                const allowed =
                  input.hook_event_name === "PreToolUse" &&
                  input.tool_name === "Read" &&
                  resolve(
                    workspace.cwd,
                    (input.tool_input as any).file_path || "",
                  ) === resolve(workspace.cwd, "notes/orders.txt");
                observe("tool-guard", {
                  name:
                    input.hook_event_name === "PreToolUse"
                      ? input.tool_name
                      : "unknown",
                  allowed,
                });
                return allowed
                  ? {}
                  : {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse",
                        permissionDecision: "deny",
                        permissionDecisionReason:
                          "Only the disposable classroom note may be read.",
                      },
                    };
              },
            ],
          },
        ],
      },
      stderr: (text) => {
        const safe = String(sanitize(text))
          .split(receiver.token)
          .join("[LOCAL AUTH REDACTED]");
        diagnostics.push(safe);
        emit({ type: "diagnostic", text: safe });
      },
    };
    observe("query-options", {
      model: MODEL,
      tools: options.tools,
      settings: publicSettings,
      maxBudgetUsd: options.maxBudgetUsd,
      transport: "OTLP HTTP/JSON to the local classroom receiver",
      traceLink: c.mode === "linked",
    });
    async function execute() {
      for await (const message of query({ prompt: PROMPTS[c.mode], options })) {
        if (message.type === "system" && message.subtype === "init")
          observe("sdk-init", {
            sessionId: message.session_id,
            model: message.model,
          });
        if (message.type === "assistant")
          for (const block of message.message.content) {
            if (block.type === "text") emit({ type: "text", text: block.text });
            if (block.type === "tool_use")
              observe("native-tool", { id: block.id, name: block.name });
          }
        if (message.type === "result") {
          const record = {
            status: message.subtype,
            sessionId: message.session_id,
            costUsd: message.total_cost_usd,
            usage: message.usage,
            text:
              message.subtype === "success"
                ? message.result
                : message.errors.join("\n"),
          };
          results.push(record);
          emit({ type: "result", result: record });
        }
      }
    }
    if (c.mode === "linked")
      host = await linkedRun(receiver.endpoint, receiver.token, execute);
    else await execute();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const data = receiver.snapshot();
    const after = await workspace.snapshot();
    const evidence = {
      mode: c.mode,
      results,
      telemetry: data,
      host,
      settings: publicSettings,
      diagnostics,
      linkedSpans: host
        ? data.traces.filter((s) => s.traceId === host.traceId)
        : [],
      promptContentPresent: JSON.stringify(data).includes(
        "CLASSROOM-PROMPT-47",
      ),
      fixtureContentPresent: JSON.stringify(data).includes(
        "CLASSROOM-CONTENT-47",
      ),
      fixtureUnchanged: before.hash === after.hash,
      fixture: after.files,
      observations,
      collectorType:
        "Bounded in-memory classroom OTLP HTTP/JSON receiver; not a production OpenTelemetry Collector distribution.",
      hookNote:
        "PreToolUse guard runs, but native hook spans require separate detailed beta tracing configuration; this app does not enable that endpoint override.",
    };
    emit({ type: "evidence", evidence });
    emit({ type: "done" });
    return evidence;
  } finally {
    await receiver.close();
    await workspace.cleanup();
  }
}
