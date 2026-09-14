import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_COLORS: Readonly<Record<string, "dim" | "muted">> = {
  "pi-cache-stats": "dim",
  "qol-attachments": "muted",
};

export default function cacheStatusColor(pi: ExtensionAPI): void {
  let restoreStatus: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || restoreStatus) return;
    const ui = ctx.ui;
    const setStatus = ui.setStatus;
    const styledSetStatus: typeof setStatus = (key, text) => {
      const color = STATUS_COLORS[key];
      return setStatus.call(ui, key, color && text ? ui.theme.fg(color, text) : text);
    };

    ui.setStatus = styledSetStatus;
    restoreStatus = () => {
      if (ui.setStatus === styledSetStatus) ui.setStatus = setStatus;
    };
  });

  pi.on("session_shutdown", () => {
    restoreStatus?.();
    restoreStatus = undefined;
  });
}
