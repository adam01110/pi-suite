import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import autoformatRenderer from "../src/glue/autoformat-renderer.js";

type TestTheme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

type MessageRenderer = (
  message: { content: unknown },
  options: { expanded: boolean },
  theme: TestTheme,
) => unknown;

const theme: TestTheme = {
  fg: (color, text) => `<${color}>${text}`,
  bold: (text) => text,
};

function captureRenderer(): MessageRenderer {
  let captured: MessageRenderer | undefined;
  const pi = {
    registerMessageRenderer: (_type: string, renderer: MessageRenderer) => {
      captured = renderer;
    },
  } as unknown as ExtensionAPI;
  autoformatRenderer(pi);
  if (!captured) throw new Error("renderer was not registered");
  return captured;
}

function render(content: string, expanded: boolean): string {
  const component = captureRenderer()({ content }, { expanded }, theme);
  expect(component).toBeInstanceOf(Text);
  return (component as Text).render(200).join("\n").trim();
}

describe("autoformat message renderer", () => {
  test("shows a collapsed summary with the expand hint", () => {
    const output = render("[pi-autoformat] Formatted 2 file(s): a.ts, b.ts", false);
    expect(output).toContain("Autoformat");
    expect(output).toContain("formatted 2 files");
    expect(output).toContain("ctrl+o to expand");
    expect(output).not.toContain("a.ts");
  });

  test("uses the singular label for one file", () => {
    const output = render("Formatted 1 file(s): a.ts", false);
    expect(output).toContain("<success>formatted 1 file<");
  });

  test("lists the formatted files when expanded", () => {
    const output = render("[pi-autoformat] Formatted 2 file(s): a.ts, b.ts", true);
    expect(output).toContain("<muted>├─ <dim>a.ts");
    expect(output).toContain("<muted>└─ <dim>b.ts");
    expect(output).not.toContain("ctrl+o to expand");
  });

  test("marks formatter failures as a warning", () => {
    const collapsed = render("[pi-autoformat] Formatted 1 file(s): a.ts\nFailures:\nboom", false);
    expect(collapsed).toContain("<warning>formatter failures");
    expect(collapsed).not.toContain("<success>");

    const expanded = render("[pi-autoformat] Formatted 1 file(s): a.ts\nFailures:\nboom", true);
    expect(expanded).toContain("<warning>boom");
  });

  test("renders unformatted content as a plain status line", () => {
    const collapsed = render("some arbitrary content", false);
    expect(collapsed).toContain("Autoformat");
    expect(collapsed).toContain("formatted 0 files");

    const expanded = render("some arbitrary content", true);
    expect(expanded).toContain("<dim>some arbitrary content");
  });
});
