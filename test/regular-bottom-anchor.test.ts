import { describe, expect, test } from "bun:test";
import type { TUI } from "@earendil-works/pi-tui";
import { bottomPaddingRows, RegularBottomAnchor } from "../src/glue/regular-bottom-anchor.js";

const component = (...lines: string[]) => ({
  render: () => lines,
  invalidate: () => {},
});

function createTui(rows: number): TUI & { mode: "regular" } {
  const widgetsAbove = component() as ReturnType<typeof component> & {
    children: ReturnType<typeof component>[];
  };
  widgetsAbove.children = [];

  return {
    mode: "regular",
    terminal: { rows },
    children: [
      component("message"),
      component(),
      component(),
      widgetsAbove,
      component("editor"),
      component(),
      component("footer"),
    ],
  } as unknown as TUI & { mode: "regular" };
}

describe("regular bottom anchor", () => {
  test("calculates only unused terminal rows", () => {
    expect(bottomPaddingRows(3, 5)).toBe(2);
    expect(bottomPaddingRows(6, 5)).toBe(0);
  });

  test("renders unused rows between transcript and editor dock", () => {
    const tui = createTui(5);
    const anchor = new RegularBottomAnchor(tui);
    const widgetsAbove = tui.children[3] as unknown as {
      children: Array<ReturnType<typeof component> | RegularBottomAnchor>;
    };
    widgetsAbove.children.push(anchor);

    expect(anchor.render(80)).toEqual(["", ""]);
  });

  test("disables itself for an unknown root layout", () => {
    const tui = createTui(5);
    tui.children.pop();
    expect(new RegularBottomAnchor(tui).render(80)).toEqual([]);
  });
});
