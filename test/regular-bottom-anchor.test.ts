import { describe, expect, test } from "bun:test";
import {
  bottomAlignSections,
  installRegularBottomAnchor,
} from "../src/glue/regular-bottom-anchor.js";

const component = (...lines: string[]) => ({
  render: () => lines,
  invalidate: () => {},
});

describe("regular bottom anchor", () => {
  test("inserts unused rows between the transcript and dock", () => {
    expect(bottomAlignSections(["message"], ["editor", "footer"], 5)).toEqual([
      "message",
      "",
      "",
      "editor",
      "footer",
    ]);
  });

  test("uses normal flow once content fills the terminal", () => {
    expect(bottomAlignSections(["one", "two"], ["editor", "footer"], 3)).toEqual([
      "one",
      "two",
      "editor",
      "footer",
    ]);
  });

  test("wraps and restores the regular renderer", () => {
    let renderRequests = 0;
    const tui = {
      mode: "regular" as const,
      terminal: { rows: 5 },
      children: [
        component("message"),
        component(),
        component(),
        component(),
        component("editor"),
        component(),
        component("footer"),
      ],
      render: () => ["original"],
      requestRender: () => {
        renderRequests++;
      },
    } as unknown as Parameters<typeof installRegularBottomAnchor>[0];

    const restore = installRegularBottomAnchor(tui);
    expect(tui.render(80)).toEqual(["message", "", "", "editor", "footer"]);
    expect(renderRequests).toBe(1);

    restore();
    expect(tui.render(80)).toEqual(["original"]);
    expect(renderRequests).toBe(2);
  });
});
