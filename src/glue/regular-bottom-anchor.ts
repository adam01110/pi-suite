import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, Container, TUI } from "@earendil-works/pi-tui";

const WIDGET_ID = "pi-suite-regular-bottom-anchor";
const ROOT_COMPONENT_COUNT = 7;
const WIDGETS_ABOVE_INDEX = 3;

type RenderTui = TUI & { mode: "regular" | "fullscreen" };

export function bottomPaddingRows(contentRows: number, terminalRows: number): number {
  return Math.max(0, terminalRows - contentRows);
}

export interface BottomAnchorState {
  mode: string;
  rootCount: number;
  contentRows: number;
  terminalRows: number;
  paddingRows: number;
}

export class RegularBottomAnchor implements Component {
  private state: BottomAnchorState;

  constructor(private readonly tui: RenderTui) {
    this.state = this.measurement(0, 0);
  }

  getState(): BottomAnchorState {
    return this.state;
  }

  render(width: number): string[] {
    const roots = this.tui.children;
    if (this.tui.mode !== "regular" || roots.length !== ROOT_COMPONENT_COUNT) {
      this.state = this.measurement(roots.length, 0);
      return [];
    }

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

    this.state = this.measurement(roots.length, contentRows);
    return Array<string>(this.state.paddingRows).fill("");
  }

  invalidate(): void {}

  private measurement(rootCount: number, contentRows: number): BottomAnchorState {
    const terminalRows = this.tui.terminal.rows;
    return {
      mode: this.tui.mode,
      rootCount,
      contentRows,
      terminalRows,
      paddingRows: bottomPaddingRows(contentRows, terminalRows),
    };
  }
}

export default function regularBottomAnchor(pi: ExtensionAPI): void {
  let anchor: RegularBottomAnchor | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_ID, (tui) => {
      anchor = new RegularBottomAnchor(tui as RenderTui);
      return anchor;
    });
  });

  pi.registerCommand("bottom-anchor", {
    description: "Show regular-mode bottom anchor state",
    handler: async (_args, ctx) => {
      ctx.ui.notify(JSON.stringify(anchor?.getState() ?? { active: false }), "info");
    },
  });
}
