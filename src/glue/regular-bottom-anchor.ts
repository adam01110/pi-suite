import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

const WIDGET_ID = "pi-suite-regular-bottom-anchor";
const ROOT_COMPONENT_COUNT = 7;
const EDITOR_ROOT_INDEX = 4;

type RootLayout = {
	width: number;
	children: Array<{ component: Component; height: number }>;
};

type RenderTui = TUI & {
	mode: "regular" | "fullscreen";
	mouseLayout?: RootLayout;
};

export function bottomPaddingRows(
	contentRows: number,
	terminalRows: number,
): number {
	return Math.max(0, terminalRows - contentRows);
}

export class RegularBottomAnchor implements Component {
	private readonly originalRender: TUI["render"];

	private readonly anchoredRender = (width: number): string[] => {
		const lines = this.originalRender.call(this.tui, width);
		if (this.tui.mode !== "regular") return lines;

		const layout = this.tui.mouseLayout;
		if (
			!layout ||
			layout.width !== width ||
			layout.children.length !== ROOT_COMPONENT_COUNT
		)
			return lines;

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

	constructor(private readonly tui: RenderTui) {
		this.originalRender = tui.render;
		tui.render = this.anchoredRender;
	}

	render(_width: number): string[] {
		return [];
	}

	invalidate(): void {}

	dispose(): void {
		if (this.tui.render === this.anchoredRender)
			this.tui.render = this.originalRender;
	}
}

export default function regularBottomAnchor(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget(
			WIDGET_ID,
			(tui) => new RegularBottomAnchor(tui as RenderTui),
		);
	});
}
