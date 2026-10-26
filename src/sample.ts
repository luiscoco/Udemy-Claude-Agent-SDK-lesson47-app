import { runAgent, validateConfig } from "./agent.js";
await runAgent(validateConfig({ mode: process.argv[2] || "all" }), (event) => {
  if (event.type === "result" || event.type === "evidence")
    console.log(JSON.stringify(event));
});
