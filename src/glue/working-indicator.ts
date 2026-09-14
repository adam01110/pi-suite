import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function workingIndicator(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWorkingIndicator({
      frames: [ctx.ui.theme.fg("accent", "●"), ctx.ui.theme.fg("dim", "●")],
      intervalMs: 500,
    });
  });
}
