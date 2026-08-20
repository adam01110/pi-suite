import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { importUpstream } from "../upstream.js";

interface AtuinConfig {
	recordAgentHistory: boolean;
}

interface HistoryEntry {
	text: string;
	timestamp: number;
}

async function openSearch(
	ctx: ExtensionContext,
	editor: CustomEditor,
	history: Record<string, any>,
	HistorySearchComponent: new (...args: any[]) => any,
): Promise<void> {
	const savedText = editor.getText();
	history.invalidateCache();
	const entries = (await history.listRecent(100)) as HistoryEntry[];
	try {
		const result = await ctx.ui.custom<string | null>(
			(_tui, theme, _keys, done) =>
				new HistorySearchComponent(done, theme, entries),
		);
		editor.setText(result ?? savedText);
	} catch {
		editor.setText(savedText);
	}
}

export default async function atuinAdapter(pi: ExtensionAPI): Promise<void> {
	const [bash, commands, configModule, history, search] = await Promise.all([
		importUpstream("pi-atuin/bash-tracker.js"),
		importUpstream("pi-atuin/commands.js"),
		importUpstream("pi-atuin/config.js"),
		importUpstream("pi-atuin/history-store.js"),
		importUpstream("pi-atuin/search-ui.js"),
	]);
	let config = configModule.loadConfig() as AtuinConfig;
	const getConfig = () => config;
	const setConfig = (next: AtuinConfig) => {
		config = next;
		configModule.saveConfig(config);
	};

	bash.registerBashTracker(pi, getConfig);
	commands.registerAtuinCommands(pi, getConfig, setConfig);
	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive" || !event.text.trim())
			return { action: "continue" as const };
		const text = event.text.trim();
		if (history.isRecentWrite(text)) return { action: "continue" as const };
		history.markRecentWrite(text);
		await history.addEntry(text, ctx.cwd);
		history.writeToAtuin(text, ctx.cwd);
		return { action: "continue" as const };
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const editorFactory = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor =
				editorFactory?.(tui, theme, keybindings) ??
				new CustomEditor(tui, theme, keybindings);
			if (!(editor instanceof CustomEditor)) {
				throw new Error(
					"The active editor is not compatible with CustomEditor",
				);
			}
			const previousShortcut = editor.onExtensionShortcut;
			editor.onExtensionShortcut = (data: string) => {
				if (matchesKey(data, Key.up) && editor.getText().length === 0) {
					void openSearch(ctx, editor, history, search.HistorySearchComponent);
					return true;
				}
				return previousShortcut?.(data) ?? false;
			};
			return editor;
		});
	});
}
