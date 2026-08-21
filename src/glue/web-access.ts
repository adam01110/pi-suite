import { contentText } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ToolTracker } from "../tool-tracker.js";
import { importUpstream } from "../upstream.js";

const SELF_RENDERED_LABELS = new Set([
	// keep-sorted start
	"Fetch Content",
	"Get Search Content",
	"Web Search",
	// keep-sorted end
]);

export default async function webAccessAdapter(
	pi: ExtensionAPI,
	tracker: ToolTracker,
): Promise<void> {
	const mark = tracker.mark();
	const webAccess = await importUpstream("pi-web-access/index.js");
	await webAccess.default(pi);

	for (const definition of tracker.registrationsSince(mark)) {
		if (SELF_RENDERED_LABELS.has(definition.label)) {
			pi.registerTool({ ...definition, renderShell: "self" });
		}
	}

	const renderStatus = (
		label: string,
		content: Parameters<typeof contentText>[0],
		theme: ExtensionContext["ui"]["theme"],
		color: "error" | "success",
	) =>
		new Text(
			`${theme.fg(color, "● ")}${theme.fg("text", theme.bold(`${label} `))}${theme.fg("muted", contentText(content, " "))}`,
			0,
			0,
		);

	pi.registerMessageRenderer(
		"web-search-content-ready",
		(message, _options, theme) =>
			renderStatus("Web Search", message.content, theme, "success"),
	);
	pi.registerMessageRenderer("web-search-error", (message, _options, theme) =>
		renderStatus("Web Search", message.content, theme, "error"),
	);
}
