import { describe, expect, mock, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ToolTracker } from "../src/tool-tracker.js";

mock.module("pi-web-access/index.js", () => ({
	default: async () => {},
}));

const { default: webAccessAdapter } = await import("../src/glue/web-access.js");

const renderers = new Map<string, Function>();
const pi = {
	registerTool: () => {},
	registerMessageRenderer: (name: string, renderer: Function) =>
		renderers.set(name, renderer),
} as unknown as ExtensionAPI;

const tracker = {
	mark: () => 0,
	registrationsSince: () => [],
} as unknown as ToolTracker;

const theme = {
	fg: (color: string, text: string) => `<${color}>${text}`,
	bold: (text: string) => text,
} as unknown as ExtensionContext["ui"]["theme"];

await webAccessAdapter(pi, tracker);

describe("web access renderers", () => {
	test("renders search results with the success color", () => {
		const renderer = renderers.get("web-search-content-ready");
		expect(renderer).toBeDefined();
		const component = renderer!(
			{ content: [{ type: "text", text: "3 results" }] },
			{},
			theme,
		);
		expect(component.render(80).join("\n")).toContain("<success>");
	});

	test("renders web search failures with the error color", () => {
		const renderer = renderers.get("web-search-error");
		expect(renderer).toBeDefined();
		const component = renderer!(
			{ content: [{ type: "text", text: "quota exceeded" }] },
			{},
			theme,
		);
		expect(component.render(80).join("\n")).toContain("<error>");
	});
});
