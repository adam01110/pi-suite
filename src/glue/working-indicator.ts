import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Gradient steps between the two colors in each direction. */
const STEPS = 5;
/** Frame interval for the gradient pulse; the full dim→accent→dim cycle is ~1.2s. */
const INTERVAL_MS = 120;
/** Flash interval for the two-frame fallback. */
const FALLBACK_INTERVAL_MS = 500;
const DOT = "●";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** Extract RGB from a foreground truecolor escape `ESC[38;2;r;g;bm`. */
export function parseTruecolor(ansi: string): Rgb | undefined {
	const match = ansi.match(/38;2;(\d+);(\d+);(\d+)m$/);
	if (!match) return undefined;
	return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function truecolorFrame({ r, g, b }: Rgb, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function lerp(a: Rgb, b: Rgb, t: number): Rgb {
	return {
		r: Math.round(a.r + (b.r - a.r) * t),
		g: Math.round(a.g + (b.g - a.g) * t),
		b: Math.round(a.b + (b.b - a.b) * t),
	};
}

/** Smoothstep eases the turnaround at each end of the pulse. */
function smooth(t: number): number {
	return t * t * (3 - 2 * t);
}

/** Ping-pong frames running dim → accent → dim with eased interpolation. */
export function gradientFrames(dim: Rgb, accent: Rgb, dot = DOT): string[] {
	const up: Rgb[] = [];
	for (let i = 0; i <= STEPS; i++) {
		up.push(lerp(dim, accent, smooth(i / STEPS)));
	}
	const path = [...up, ...up.slice(1, -1).reverse()];
	return path.map((color) => truecolorFrame(color, dot));
}

export default function workingIndicator(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;
		let frames: string[] | undefined;
		try {
			const dim = parseTruecolor(theme.getFgAnsi("dim"));
			const accent = parseTruecolor(theme.getFgAnsi("accent"));
			if (dim && accent) frames = gradientFrames(dim, accent);
		} catch {
			// Unknown theme color: fall through to the two-frame flash.
		}

		if (frames) {
			ctx.ui.setWorkingIndicator({ frames, intervalMs: INTERVAL_MS });
		} else {
			ctx.ui.setWorkingIndicator({
				frames: [theme.fg("accent", DOT), theme.fg("dim", DOT)],
				intervalMs: FALLBACK_INTERVAL_MS,
			});
		}
	});
}
