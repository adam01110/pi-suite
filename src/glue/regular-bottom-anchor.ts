import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

const WIDGET_ID = "pi-suite-regular-bottom-anchor";
const ROOT_COMPONENT_COUNT = 7;
const EDITOR_ROOT_INDEX = 4;

type RootLayout = {
  width: number;
  children: Array<{ component: Component; height: number }>;
};

type CursorPosition = { row: number; col: number } | null;

type RenderTui = TUI & {
  mode: "regular" | "fullscreen";
  mouseLayout?: RootLayout;
  previousViewportTop: number;
  hardwareCursorRow: number;
  positionHardwareCursor(cursor: CursorPosition, totalLines: number): void;
  getShowHardwareCursor(): boolean;
};

export function bottomPaddingRows(contentRows: number, terminalRows: number): number {
  return Math.max(0, terminalRows - contentRows);
}

export class RegularBottomAnchor implements Component {
  private readonly originalRender: TUI["render"];
  private readonly originalPositionHardwareCursor: RenderTui["positionHardwareCursor"];
  private ownsViewport = false;

  private readonly anchoredRender = (width: number): string[] => {
    const lines = this.originalRender.call(this.tui, width);
    this.ownsViewport = false;
    if (this.tui.mode !== "regular") return lines;

    const layout = this.tui.mouseLayout;
    if (!layout || layout.width !== width || layout.children.length !== ROOT_COMPONENT_COUNT)
      return lines;

    this.ownsViewport = true;
    const paddingRows = bottomPaddingRows(lines.length, this.tui.terminal.rows);
    if (paddingRows === 0) return lines;

    const editorOffset = layout.children
      .slice(0, EDITOR_ROOT_INDEX)
      .reduce((rows, child) => rows + child.height, 0);
    // Spacer belongs to widgets-above for mouse coordinate accounting.
    layout.children[EDITOR_ROOT_INDEX - 1].height += paddingRows;
    return [
      ...lines.slice(0, editorOffset),
      ...Array<string>(paddingRows).fill(""),
      ...lines.slice(editorOffset),
    ];
  };

  private readonly anchoredPositionHardwareCursor = (
    cursor: CursorPosition,
    totalLines: number,
  ): void => {
    if (!this.ownsViewport || !cursor || totalLines <= 0) {
      this.originalPositionHardwareCursor.call(this.tui, cursor, totalLines);
      return;
    }

    const targetRow = Math.max(0, Math.min(cursor.row, totalLines - 1));
    const screenRow = Math.max(
      0,
      Math.min(this.tui.terminal.rows - 1, targetRow - this.tui.previousViewportTop),
    );
    const targetColumn = Math.max(0, cursor.col);

    // Relative cursor movement drifts when a main-screen redraw scrolls or the
    // terminal clamps movement during resize. Anchored frames own the viewport,
    // so an absolute position reliably re-synchronizes the next diff render.
    this.tui.terminal.write(`\x1b[${screenRow + 1};${targetColumn + 1}H`);
    this.tui.hardwareCursorRow = targetRow;
    if (this.tui.getShowHardwareCursor()) this.tui.terminal.showCursor();
    else this.tui.terminal.hideCursor();
  };

  constructor(private readonly tui: RenderTui) {
    this.originalRender = tui.render;
    this.originalPositionHardwareCursor = tui.positionHardwareCursor;
    tui.render = this.anchoredRender;
    tui.positionHardwareCursor = this.anchoredPositionHardwareCursor;
  }

  render(_width: number): string[] {
    return [];
  }

  invalidate(): void {}

  dispose(): void {
    if (this.tui.render === this.anchoredRender) this.tui.render = this.originalRender;
    if (this.tui.positionHardwareCursor === this.anchoredPositionHardwareCursor)
      this.tui.positionHardwareCursor = this.originalPositionHardwareCursor;
  }
}

export default function regularBottomAnchor(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_ID, (tui) => new RegularBottomAnchor(tui as RenderTui));
  });
}
