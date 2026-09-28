import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_COLORS: Readonly<Record<string, "dim" | "muted">> = {
	"pi-cache-stats": "dim",
	"qol-attachments": "muted",
};

// Cache Optimizer buckets counts by provider/model, but labels them by model
// family. On OpenCode Go, "OpenAI cache" describes the model family, not the
// gateway reporting the usage. Keep its measured counts and make the source
// explicit rather than implying they came from the official OpenAI API.
function attributeCacheStats(
	text: string,
	provider: string | undefined,
): string {
	if (provider !== "opencode-go") return text;
	return text.replace(
		/\b([A-Za-z][\w-]*) cache(?= \d+\/\d+·)/,
		(_match, family: string) => `OpenCode Go cache (${family})`,
	);
}

export default function cacheStatusColor(pi: ExtensionAPI): void {
	let restoreStatus: (() => void) | undefined;
	let activeProvider: string | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || restoreStatus) return;
		activeProvider = ctx.model?.provider;
		const ui = ctx.ui;
		const setStatus = ui.setStatus;
		const styledSetStatus: typeof setStatus = (key, text) => {
			const color = STATUS_COLORS[key];
			const displayText =
				key === "pi-cache-stats" && text
					? attributeCacheStats(text, activeProvider)
					: text;
			return setStatus.call(
				ui,
				key,
				color && displayText ? ui.theme.fg(color, displayText) : displayText,
			);
		};

		ui.setStatus = styledSetStatus;
		restoreStatus = () => {
			if (ui.setStatus === styledSetStatus) ui.setStatus = setStatus;
		};
	});

	pi.on("model_select", (event, ctx) => {
		activeProvider = event.model.provider;
		// Do not leave the previous provider's counters visible while the async
		// Cache Optimizer handler loads the new model's bucket.
		if (ctx.hasUI && restoreStatus)
			ctx.ui.setStatus("pi-cache-stats", undefined);
	});

	pi.on("session_shutdown", () => {
		restoreStatus?.();
		restoreStatus = undefined;
		activeProvider = undefined;
	});
}
