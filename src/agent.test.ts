import { test } from "node:test";
import assert from "node:assert/strict";
import { telemetryEnvironment, resourceTags } from "./settings.js";
import { startCollector, flatten, sanitize } from "./collector.js";
import { validateConfig } from "./protocol.js";
import { prepareWorkspace } from "./workspace.js";

test("signals are independent and content export is explicit", () => {
  for (const mode of ["metrics", "logs", "traces"] as const) {
    const env = telemetryEnvironment(mode, "http://127.0.0.1:1234", "test");
    for (const signal of ["metrics", "logs", "traces"])
      assert.equal(
        (env as any)[`OTEL_${signal.toUpperCase()}_EXPORTER`],
        mode === signal ? "otlp" : "none",
      );
    assert.equal(env.OTEL_LOG_USER_PROMPTS, "0");
    assert.equal(env.OTEL_LOG_TOOL_CONTENT, "0");
  }
  assert.equal(
    telemetryEnvironment("content", "", "").OTEL_LOG_USER_PROMPTS,
    "1",
  );
  assert.equal(
    telemetryEnvironment("off", "", "").CLAUDE_CODE_ENABLE_TELEMETRY,
    "0",
  );
  assert.ok(resourceTags("tags").includes("student%2047"));
});
test("resource attributes and OTLP records retain native trace links", () => {
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "enduser.id", value: { stringValue: "student 47" } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: "native",
                traceId: "abc",
                spanId: "123",
                parentSpanId: "456",
                attributes: [{ key: "count", value: { intValue: "5" } }],
              },
            ],
          },
        ],
      },
    ],
  };
  const [span] = flatten("traces", payload);
  assert.equal(span.traceId, "abc");
  assert.equal(span.attributes.count, "5");
  assert.equal(span.resource["enduser.id"], "student 47");
});
test("the receiver requires ephemeral auth and rejects invalid OTLP", async () => {
  const receiver = await startCollector(() => {});
  try {
    assert.equal(
      (
        await fetch(receiver.endpoint + "/v1/logs", {
          method: "POST",
          body: "{}",
        })
      ).status,
      403,
    );
    const headers = {
      Authorization: `Bearer ${receiver.token}`,
      "Content-Type": "application/json",
    };
    assert.equal(
      (
        await fetch(receiver.endpoint + "/v1/logs", {
          method: "POST",
          headers,
          body: "invalid",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(receiver.endpoint + "/v1/logs", {
          method: "POST",
          headers,
          body: JSON.stringify({ resourceLogs: [] }),
        })
      ).status,
      200,
    );
    assert.equal(receiver.snapshot().requests.length, 1);
  } finally {
    await receiver.close();
  }
});
test("public evidence redacts account identity and credentials", () => {
  const old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "private-test-secret";
  try {
    const data = sanitize([
      { key: "user.email", value: { stringValue: "private@example.com" } },
      "private-test-secret",
    ]);
    assert.ok(!JSON.stringify(data).includes("private@example.com"));
    assert.ok(!JSON.stringify(data).includes("private-test-secret"));
  } finally {
    if (old === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = old;
  }
});
test("run configuration cannot supply an arbitrary exporter destination or tools", () => {
  assert.throws(() =>
    validateConfig({ mode: "all", endpoint: "https://example.com" }),
  );
  assert.throws(() => validateConfig({ mode: "unknown" }));
  assert.deepEqual(validateConfig({ mode: "linked" }), { mode: "linked" });
});
test("temporary classroom data is real and can be cleaned safely", async () => {
  const workspace = await prepareWorkspace();
  try {
    const snapshot = await workspace.snapshot();
    assert.match(snapshot.files[1].text, /CLASSROOM-CONTENT-47/);
    assert.equal(snapshot.hash, (await workspace.snapshot()).hash);
  } finally {
    await workspace.cleanup();
  }
});
