export const MODES = [
  "all",
  "metrics",
  "logs",
  "traces",
  "linked",
  "tags",
  "content",
  "off",
  "unreachable",
] as const;
export type Mode = (typeof MODES)[number];
export type RunConfig = { mode: Mode };
export type LabEvent = { type: string; [key: string]: any };
export function validateConfig(input: any): RunConfig {
  if (
    !input ||
    Object.keys(input).some((k) => k !== "mode") ||
    !MODES.includes(input.mode)
  )
    throw new Error("Choose a listed telemetry experiment.");
  return { mode: input.mode };
}
