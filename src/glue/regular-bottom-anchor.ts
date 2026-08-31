import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, Container, TUI } from "@earendil-works/pi-tui";

const WIDGET_ID = "pi-suite-regular-bottom-anchor";
const ROOT_COMPONENT_COUNT = 7;
const WIDGETS_ABOVE_INDEX = 3;

type RenderTui = TUI & { mode: "regular" | "fullscreen" };

export function bottomPaddingRows(contentRows: number, terminalRows: number): number {
  return Math.max(0, terminalRows - contentRows);
}

export class RegularBottomAnchor implements Component {
  constructor(private readonly tui: RenderTui) {}

  render(width: number): string[] {
    const roots = this.tui.children;
    if (this.tui.mode !== "regular" || roots.length !== ROOT_COMPONENT_COUNT) return [];

    let contentRows = 0;
    for (const [index, root] of roots.entries()) {
      if (index !== WIDGETS_ABOVE_INDEX) {
        contentRows += root.render(width).length;
        continue;
      }

      for (const widget of (root as Container).children) {
        if (widget !== this) contentRows += widget.render(width).length;
      }
    }

    return Array<string>(bottomPaddingRows(contentRows, this.tui.terminal.rows)).fill("");
  }

  invalidate(): void {}
}

export default function regularBottomAnchor(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_ID, (tui) => new RegularBottomAnchor(tui as RenderTui));
  });
}
