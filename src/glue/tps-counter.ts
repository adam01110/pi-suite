import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "tps";
const WINDOW_MS = 4_000;
const UPDATE_INTERVAL_MS = 250;
// Streaming usage is only reliable once the message finishes for some
// providers, so fall back to a chars/4 estimate between usage reports.
const CHARS_PER_TOKEN = 4;

export type TpsSample = {
  timestamp: number;
  outputTokens: number;
};

export function addTpsSample(
  samples: readonly TpsSample[],
  outputTokens: number,
  timestamp: number,
  windowMs = WINDOW_MS,
): TpsSample[] {
  const sample = { timestamp, outputTokens };
  const last = samples.at(-1);
  if (last && outputTokens < last.outputTokens) return [sample];

  const cutoff = timestamp - windowMs;
  return [...samples, sample].filter((item) => item.timestamp >= cutoff);
}

export function calculateTps(samples: readonly TpsSample[]): number | undefined {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) return undefined;

  const elapsedMs = last.timestamp - first.timestamp;
  const outputTokens = last.outputTokens - first.outputTokens;
  if (elapsedMs <= 0 || outputTokens <= 0) return undefined;
  return (outputTokens * 1_000) / elapsedMs;
}

export function canUpdateTps(
  lastUpdateAt: number | undefined,
  timestamp: number,
  intervalMs = UPDATE_INTERVAL_MS,
): boolean {
  return lastUpdateAt === undefined || timestamp - lastUpdateAt >= intervalMs;
}

export function registerTpsCounter(pi: ExtensionAPI, now: () => number): void {
  let samples: TpsSample[] = [];
  let lastUpdateAt: number | undefined;
  let lastUsageOutput = 0;
  let tokens = 0;

  pi.on("message_start", (event, _ctx) => {
    if (event.message.role !== "assistant") return;
    samples = [];
    lastUpdateAt = undefined;
    lastUsageOutput = event.message.usage?.output ?? 0;
    tokens = lastUsageOutput;
  });

  pi.on("message_update", (event, ctx) => {
    const update = event.assistantMessageEvent;
    if (
      update.type !== "text_delta" &&
      update.type !== "thinking_delta" &&
      update.type !== "toolcall_delta"
    )
      return;

    const usageOutput = update.partial?.usage?.output ?? 0;
    if (usageOutput > lastUsageOutput) {
      lastUsageOutput = usageOutput;
      tokens = Math.max(tokens, usageOutput);
    } else if (typeof update.delta === "string") {
      tokens += update.delta.length / CHARS_PER_TOKEN;
    } else {
      return;
    }

    const timestamp = now();
    samples = addTpsSample(samples, Math.round(tokens), timestamp);
    const tps = calculateTps(samples);
    if (!ctx.hasUI || tps === undefined || !canUpdateTps(lastUpdateAt, timestamp)) return;

    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", `\uf0e7 ${Math.round(tps)} t/s`));
    lastUpdateAt = timestamp;
  });

  // Keep the last measured rate visible between turns.
  pi.on("message_end", () => {
    samples = [];
    lastUpdateAt = undefined;
  });
}

export default function tpsCounter(pi: ExtensionAPI): void {
  registerTpsCounter(pi, () => performance.now());
}
