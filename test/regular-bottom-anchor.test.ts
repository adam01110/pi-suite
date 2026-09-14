import { describe, expect, test } from "bun:test";
import { Container, type TUI } from "@earendil-works/pi-tui";
import {
	bottomPaddingRows,
	RegularBottomAnchor,
} from "../src/glue/regular-bottom-anchor.js";

function component(lines: string[], rendered?: () => void) {
	return {
		render: () => {
			rendered?.();
			return lines;
		},
		invalidate: () => {},
	};
}

function createTui(rows: number): TUI & { mode: "regular" } {
	const widgetsAbove = new Container();
	const root = new Container();
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
		mode: "regular",
		terminal: { columns: 80, rows },
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

	test("restores patched render method when disposed", () => {
		const tui = createTui(5);
		const originalRender = tui.render;
		const anchor = new RegularBottomAnchor(tui);

		anchor.dispose();
		expect(tui.render).toBe(originalRender);
	});

	test("does not alter an unknown root layout", () => {
		const tui = createTui(5);
		const anchor = new RegularBottomAnchor(tui);
		(tui.children[3] as Container).addChild(anchor);
		tui.children.pop();

		expect(tui.render(80)).toEqual(["message", "editor"]);
	});
});
