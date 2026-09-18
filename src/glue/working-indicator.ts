import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Ten-step braille spinner; one rotation per 800ms at 80ms per frame. */
export const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

const INTERVAL_MS = 80;

/** Color every frame with one theme color; custom frames render verbatim. */
export function spinnerFrames(
	fg: (text: string) => string,
	frames: readonly string[] = SPINNER_FRAMES,
): string[] {
	return frames.map((frame) => fg(frame));
}

export default function workingIndicator(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;
		ctx.ui.setWorkingIndicator({
			frames: spinnerFrames((text) => theme.fg("accent", text)),
			intervalMs: INTERVAL_MS,
		});
	});
}
