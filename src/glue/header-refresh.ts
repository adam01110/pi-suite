import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

const WRAPPED = Symbol("pi-suite-header-refresh-wrapped");

type HeaderComponent = Component & { reapply?: () => void };

type HeaderFactory = (tui: unknown, theme: unknown) => HeaderComponent;

type HeaderUI = ExtensionContext["ui"] & {
	setHeader: (factory: HeaderFactory | undefined) => void;
};

let customHeader: HeaderComponent | undefined;

/**
 * pi-cc-header caches its info rows (model line included) keyed by width only
 * and never listens to model_select or thinking_level_select, so the profile
 * switcher and the thinking-level keybinding leave the header showing the
 * previous model and effort. This glue must load before the header module so
 * its session_start wraps setHeader first; the wrapper tracks the mounted
 * header component and reapplies it (clear cache + requestRender, no remount)
 * whenever either changes.
 */
export default function headerRefresh(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const ui = ctx.ui as unknown as HeaderUI & Record<symbol, unknown>;
		if (ui[WRAPPED]) return;
		ui[WRAPPED] = true;

		const setHeader = ui.setHeader;
		ui.setHeader = (factory) => {
			if (!factory) {
				customHeader = undefined;
				setHeader(undefined);
				return;
			}
			setHeader((tui, theme) => {
				customHeader = factory(tui, theme);
				return customHeader;
			});
		};
	});

	const refresh = () => {
		customHeader?.reapply?.();
	};

	pi.on("model_select", refresh);
	pi.on("thinking_level_select", refresh);
}
