import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "tps";
const WINDOW_MS = 4_000;
const UPDATE_INTERVAL_MS = 250;

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

  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    samples = [{ timestamp: now(), outputTokens: event.message.usage.output }];
    lastUpdateAt = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("message_update", (event, ctx) => {
    const update = event.assistantMessageEvent;
    if (
      update.type !== "text_delta" &&
      update.type !== "thinking_delta" &&
      update.type !== "toolcall_delta"
    )
      return;

    const timestamp = now();
    samples = addTpsSample(samples, update.partial.usage.output, timestamp);
    const tps = calculateTps(samples);
    if (!ctx.hasUI || tps === undefined || !canUpdateTps(lastUpdateAt, timestamp)) return;

    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", `\uf0e7 ${Math.round(tps)} t/s`));
    lastUpdateAt = timestamp;
  });

  pi.on("message_end", (_event, ctx) => {
    samples = [];
    lastUpdateAt = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

export default function tpsCounter(pi: ExtensionAPI): void {
  registerTpsCounter(pi, () => performance.now());
}
