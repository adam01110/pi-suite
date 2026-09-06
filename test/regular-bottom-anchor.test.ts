import { describe, expect, test } from "bun:test";
import { Container, type TUI } from "@earendil-works/pi-tui";
import { bottomPaddingRows, RegularBottomAnchor } from "../src/glue/regular-bottom-anchor.js";

function component(lines: string[], rendered?: () => void) {
  return {
    render: () => {
      rendered?.();
      return lines;
    },
    invalidate: () => {},
  };
}

function createTui(rows: number): TUI & {
  mode: "regular";
  hardwareCursorRow: number;
  previousViewportTop: number;
  positionHardwareCursor(cursor: { row: number; col: number } | null, totalLines: number): void;
  terminal: TUI["terminal"] & { writes: string[] };
} {
  const widgetsAbove = new Container();
  const root = new Container();
  const writes: string[] = [];
  root.children = [
    component(["message"]),
    component([]),
    component([]),
    widgetsAbove,
    component(["editor"]),
    component([]),
    component(["footer"]),
  ];
  Object.assign(root, {
    hardwareCursorRow: 0,
    mode: "regular",
    previousViewportTop: 0,
    positionHardwareCursor: () => writes.push("relative"),
    getShowHardwareCursor: () => false,
    terminal: {
      columns: 80,
      hideCursor: () => {},
      rows,
      showCursor: () => {},
      write: (data: string) => writes.push(data),
      writes,
    },
  });
  return root as unknown as ReturnType<typeof createTui>;
}

describe("regular bottom anchor", () => {
  test("calculates only unused terminal rows", () => {
    expect(bottomPaddingRows(3, 5)).toBe(2);
    expect(bottomPaddingRows(6, 5)).toBe(0);
  });

  test("inserts unused rows before the editor", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    const widgetsAbove = tui.children[3] as Container;
    widgetsAbove.addChild(anchor);

    expect(tui.render(80)).toEqual(["message", "", "", "editor", "footer"]);
  });

  test("renders each stateful component once per frame", () => {
    let editorRenders = 0;
    const tui = createTui(5);
    tui.children[4] = component(["editor"], () => editorRenders++);
    const anchor = new RegularBottomAnchor(tui);
    (tui.children[3] as Container).addChild(anchor);

    tui.render(80);
    expect(editorRenders).toBe(1);

    (tui.terminal as { rows: number }).rows = 4;
    expect(tui.render(60)).toEqual(["message", "", "editor", "footer"]);
    expect(editorRenders).toBe(2);
  });

  test("leaves fullscreen rendering unchanged", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    (tui.children[3] as Container).addChild(anchor);
    Object.assign(tui, { mode: "fullscreen" });

    expect(tui.render(80)).toEqual(["message", "editor", "footer"]);
  });

  test("uses absolute cursor positioning for anchored frames", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    (tui.children[3] as Container).addChild(anchor);
    tui.previousViewportTop = 2;

    tui.render(80);
    tui.positionHardwareCursor({ row: 4, col: 3 }, 7);

    expect(tui.terminal.writes).toEqual(["\x1b[3;4H"]);
    expect(tui.hardwareCursorRow).toBe(4);
  });

  test("delegates cursor positioning for unanchored frames", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    (tui.children[3] as Container).addChild(anchor);
    Object.assign(tui, { mode: "fullscreen" });

    tui.render(80);
    tui.positionHardwareCursor({ row: 1, col: 2 }, 3);

    expect(tui.terminal.writes).toEqual(["relative"]);
  });

  test("restores patched methods when disposed", () => {
    const tui = createTui(5);
    const originalRender = tui.render;
    const originalPositionHardwareCursor = tui.positionHardwareCursor;
    const anchor = new RegularBottomAnchor(tui);

    anchor.dispose();
    expect(tui.render).toBe(originalRender);
    expect(tui.positionHardwareCursor).toBe(originalPositionHardwareCursor);
  });

  test("does not alter an unknown root layout", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    (tui.children[3] as Container).addChild(anchor);
    tui.children.pop();

    expect(tui.render(80)).toEqual(["message", "editor"]);
  });
});
