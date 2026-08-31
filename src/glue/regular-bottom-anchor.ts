import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const WIDGET_ID = "pi-suite-regular-bottom-anchor";
const ROOT_COMPONENT_COUNT = 7;
const DOCK_COMPONENT_COUNT = 6;

type RenderTui = TUI & {
  mode: "regular" | "fullscreen";
  render(width: number): string[];
};

export function bottomAlignSections(
  transcript: readonly string[],
  dock: readonly string[],
  terminalRows: number,
): string[] {
  const padding = Math.max(0, terminalRows - transcript.length - dock.length);
  return [...transcript, ...Array<string>(padding).fill(""), ...dock];
}

export function installRegularBottomAnchor(tui: RenderTui): () => void {
  if (tui.mode !== "regular") return () => {};

  const hadOwnRender = Object.hasOwn(tui, "render");
  const ownRender = Object.getOwnPropertyDescriptor(tui, "render");
  const render = tui.render;

  Object.defineProperty(tui, "render", {
    configurable: true,
    writable: true,
    value(this: RenderTui, width: number): string[] {
      if (this.children.length !== ROOT_COMPONENT_COUNT) return render.call(this, width);

      const split = ROOT_COMPONENT_COUNT - DOCK_COMPONENT_COUNT;
      const transcript = this.children
        .slice(0, split)
        .flatMap((component) => component.render(width));
      const dock = this.children.slice(split).flatMap((component) => component.render(width));
      return bottomAlignSections(transcript, dock, this.terminal.rows);
    },
  });
  tui.requestRender(true);

  return () => {
    if (hadOwnRender && ownRender) Object.defineProperty(tui, "render", ownRender);
    else delete (tui as Partial<RenderTui>).render;
    tui.requestRender(true);
  };
}

export default function regularBottomAnchor(pi: ExtensionAPI): void {
  let restore: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setWidget(WIDGET_ID, (tui) => {
      restore?.();
      restore = installRegularBottomAnchor(tui as RenderTui);
      return {
        render: () => [],
        invalidate: () => {},
      };
    });
  });

  pi.on("session_shutdown", () => {
    restore?.();
    restore = undefined;
  });
}
