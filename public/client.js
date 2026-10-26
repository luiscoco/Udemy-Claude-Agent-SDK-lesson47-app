import { renderMarkdown } from "./markdown.js";
const $ = (id) => document.getElementById(id);
let rows = [], data = { traces: [], metrics: [], logs: [], requests: [] };
function json(id, value) { $(id).textContent = JSON.stringify(value, null, 2); window.Prism?.highlightElement($(id)); }
function table(id, records) {
    $(id).replaceChildren(...records.map(values => {
        const tr = document.createElement("tr");
        for (const value of values) {
            const td = document.createElement("td");
            td.textContent = String(value ?? "—");
            tr.append(td);
        }
        return tr;
    }));
}
function draw() {
    $("span-count").textContent = String(data.traces.length);
    $("metric-count").textContent = String(data.metrics.length);
    $("log-count").textContent = String(data.logs.length);
    const unique = new Map(data.traces.map((s) => [s.spanId, s]));
    const tree = [];
    function visit(s, depth, seen) {
        if (seen.has(s.spanId))
            return;
        const next = new Set(seen).add(s.spanId);
        tree.push(["　".repeat(Math.min(depth, 5)) + s.name, s.traceId, s.spanId, s.parentSpanId || "root", ((Number(s.endTimeUnixNano) - Number(s.startTimeUnixNano)) / 1e6).toFixed(1)]);
        for (const child of unique.values())
            if (child.parentSpanId === s.spanId)
                visit(child, depth + 1, next);
    }
    for (const s of unique.values())
        if (!unique.has(s.parentSpanId))
            visit(s, 0, new Set());
    table("trace-history", tree);
    table("metric-history", data.metrics.map((m) => [m.name, m.asDouble ?? m.asInt ?? m.count, m.unit, JSON.stringify(m.attributes), m.temporality]));
    const filter = $("user-filter").value.trim();
    const logs = data.logs.filter((l) => !filter || l.resource["enduser.id"] === filter);
    table("log-history", logs.map((l) => [l.body, l.resource["enduser.id"], l.traceId || "—", JSON.stringify(l.attributes)]));
    json("telemetry", data);
    json("requests", data.requests);
}
$("user-filter").addEventListener("input", draw);
$("run").onclick = async () => {
    const button = $("run");
    button.disabled = true;
    rows = [];
    data = { traces: [], metrics: [], logs: [], requests: [] };
    draw();
    $("conversation").replaceChildren();
    $("status").textContent = "Running actual SDK and receiving telemetry…";
    json("evidence", {});
    json("storage", {});
    json("diagnostics", []);
    json("options", {});
    try {
        const response = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: $("mode").value }) });
        if (!response.ok)
            throw new Error(await response.text());
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                if (!frame.startsWith("data: "))
                    continue;
                const event = JSON.parse(frame.slice(6));
                rows.push(event);
                if (event.type === "telemetry") {
                    data = event.data;
                    draw();
                }
                if (event.type === "text") {
                    const article = document.createElement("article");
                    renderMarkdown(article, event.text);
                    $("conversation").append(article);
                }
                if (event.type === "observation" && event.observation.kind === "query-options")
                    json("options", event.observation.detail);
                if (event.type === "result")
                    json("native-result", event.result);
                if (event.type === "evidence") {
                    data = event.evidence.telemetry;
                    draw();
                    json("evidence", event.evidence);
                    json("storage", { host: event.evidence.host, linkedSpans: event.evidence.linkedSpans, promptContentPresent: event.evidence.promptContentPresent, fixtureContentPresent: event.evidence.fixtureContentPresent });
                    json("diagnostics", event.evidence.diagnostics);
                    $("status").textContent = "Complete · actual SDK and OTLP evidence ready";
                }
                if (event.type === "error")
                    throw new Error(event.message || "Run failed.");
            }
        }
    }
    catch (error) {
        $("status").textContent = String(error);
    }
    finally {
        button.disabled = false;
    }
};
$("download").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lesson47-native-observations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
fetch("/api/config").then(r => r.json()).then(c => {
    $("configuration").textContent = c.ready ? `Ready · ${c.model} · native CLI telemetry · private API key configured` : "Configure your private API key. See How to run.";
    $("run").disabled = !c.ready;
}).catch(() => { $("configuration").textContent = "Server unavailable. See How to run."; });
