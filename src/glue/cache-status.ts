import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_COLORS: Readonly<Record<string, "dim" | "muted">> = {
  "pi-cache-stats": "dim",
  "qol-attachments": "muted",
};

// pi-opencode-go-cache publishes a standalone footer item that only states
// "enabled". The Cache Optimizer footer already measures the real gateway
// caching and labels it "OpenCode Go cache (<family>)", so the redundant
// item is dropped before it can reach the status bar.
const DROPPED_STATUS_KEYS: ReadonlySet<string> = new Set(["opencode-go-cache"]);

// Cache Optimizer buckets counts by provider/model, but labels them by model
// family. On OpenCode Go, "OpenAI cache" describes the model family, not the
// gateway reporting the usage. Keep its measured counts and make the source
// explicit rather than implying they came from the official OpenAI API.
function attributeCacheStats(text: string, provider: string | undefined): string {
  if (provider !== "opencode-go") return text;
  return text.replace(
    /\b([A-Za-z][\w-]*) cache(?= \d+\/\d+·)/,
    (_match, family: string) => `OpenCode Go cache (${family})`,
  );
}

export default function cacheStatusColor(pi: ExtensionAPI): void {
  let restoreStatus: (() => void) | undefined;
  let activeProvider: string | undefined;

  function installStatusWrapper(ctx: {
    hasUI: boolean;
    ui: {
      setStatus: (key: string, text: string | undefined) => void;
      theme: { fg: (color: string, text: string) => string };
    };
  }): void {
    if (restoreStatus || !ctx.hasUI) return;
    const ui = ctx.ui;
    const setStatus = ui.setStatus;
    const styledSetStatus: typeof setStatus = (key, text) => {
      if (DROPPED_STATUS_KEYS.has(key)) return setStatus(key, undefined);
      const color = STATUS_COLORS[key];
      const displayText =
        key === "pi-cache-stats" && text ? attributeCacheStats(text, activeProvider) : text;
      return setStatus.call(
        ui,
        key,
        color && displayText ? ui.theme.fg(color, displayText) : displayText,
      );
    };

    ui.setStatus = styledSetStatus;
    restoreStatus = () => {
      if (ui.setStatus === styledSetStatus) ui.setStatus = setStatus;
    };
  }

  pi.on("session_start", (_event, ctx) => {
    activeProvider = ctx.model?.provider;
    installStatusWrapper(ctx);
  });

  pi.on("model_select", (event, ctx) => {
    activeProvider = event.model?.provider;
    installStatusWrapper(ctx);
    // Do not leave the previous provider's counters visible while the async
    // Cache Optimizer handler loads the new model's bucket.
    if (ctx.hasUI && restoreStatus) ctx.ui.setStatus("pi-cache-stats", undefined);
  });

  pi.on("session_shutdown", () => {
    restoreStatus?.();
    restoreStatus = undefined;
    activeProvider = undefined;
  });
}
