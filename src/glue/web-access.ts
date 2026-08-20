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

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(part): part is { type: "text"; text: string } =>
					!!part &&
					typeof part === "object" &&
					(part as { type?: unknown }).type === "text",
			)
			.map((part) => part.text)
			.join(" ");
	}
	return "";
}

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
		content: unknown,
		theme: ExtensionContext["ui"]["theme"],
		color: "error" | "success",
	) =>
		new Text(
			`${theme.fg(color, "● ")}${theme.fg("text", theme.bold(`${label} `))}${theme.fg("muted", messageText(content))}`,
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
