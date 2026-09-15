import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Model-profile side effects for the premade startup picker and /model:
 *
 * - The web-access summarizer follows the session model by rewriting
 *   summaryModel in web-search.json on every explicit model change.
 * - Subagent role tokens (`coder`, `fast`, `worker`) in the deployed agent files
 *   are rewritten to the concrete model + thinking level configured in
 *   PI_SUITE_PROFILE_AGENTS. Entries without `model` inherit the session
 *   model; mapping keys are matched as `provider/modelId` first, then
 *   provider. Applied values are tracked in a sidecar state file so later
 *   switches can find the previously written lines, while hand-pinned model
 *   or thinking values the glue never wrote stay untouched.
 * - Non-OpenAI catalogs omit common thinking levels (glm-5.3-flash has no
 *   off/medium, deepseek-v4.1-flash has no low/medium), so pi's downward
 *   clamp lands on the wrong level. When the session's thinking level is not
 *   supported by the new model, offer its supported levels; cancel applies
 *   "high" so the medium default never clamps to off.
 */

const LEVEL_ORDER = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

type Level = (typeof LEVEL_ORDER)[number];

const PROMPT_ORDER: readonly Level[] = [
	"high",
	"low",
	"medium",
	"off",
	"minimal",
	"xhigh",
	"max",
];

type LevelMap = Record<string, string | null | undefined>;

export interface ProfileEntry {
	model?: string;
	thinking?: string;
}

/** Session-level settings for a profile; `model` names provider/modelId. */
export interface ProfileSession {
	model?: string;
	thinking?: string;
}

/** `session` is reserved; every other key is a subagent role token. */
export interface Profile {
	session?: ProfileSession;
	[role: string]: ProfileEntry | ProfileSession | undefined;
}

export type ProfileConfig = Record<string, Profile>;

export interface AgentProfileOptions {
	agentDir?: string;
	config?: ProfileConfig;
}

/** Last value the glue wrote for a token. `null` = line removed / none. */
type AppliedEntry = { model?: string | null; thinking?: string | null };

type ProfileState = Record<string, Record<string, AppliedEntry>>;

function agentRootPath(): string {
	const explicitDir = process.env.PI_CODING_AGENT_DIR?.trim();
	return explicitDir || join(homedir(), ".pi", "agent");
}

function agentDirPath(): string {
	return join(agentRootPath(), "agents");
}

function statePath(dir: string): string {
	// Colocated with the agent files: scoping the state to one agent dir keeps
	// test sandboxes isolated and survives directory moves.
	return join(dir, "pi-suite-profile-state.json");
}

/**
 * Profile config source: PI_SUITE_PROFILE_AGENTS holds either a JSON blob
 * or a path to one; unset, the declarative file home-manager writes to the
 * agent dir is used.
 */
function profileConfigPath(): string {
	const explicit = process.env.PI_SUITE_PROFILE_AGENTS?.trim();
	return explicit || join(agentRootPath(), "pi-profile-agents.json");
}

export function loadProfileConfig(): ProfileConfig | undefined {
	const raw = process.env.PI_SUITE_PROFILE_AGENTS?.trim();
	let text = raw;
	if (raw && !raw.startsWith("{")) {
		// A path to a JSON file (home-manager store path or writable file).
		try {
			text = existsSync(raw) ? readFileSync(raw, "utf8") : undefined;
		} catch {
			text = undefined;
		}
	}
	if (!text) {
		const path = profileConfigPath();
		if (!existsSync(path)) return undefined;
		text = readFileSync(path, "utf8");
	}
	if (!text) return undefined;
	try {
		const parsed = JSON.parse(text) as ProfileConfig;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function profileFor(
	config: ProfileConfig,
	model: Pick<Model<any>, "provider" | "id">,
): Profile | undefined {
	const ref = `${model.provider}/${model.id}`;
	for (const profile of Object.values(config)) {
		if (profile.session?.model === ref) return profile;
	}
	// Legacy key formats: provider/modelId or provider-wide keys.
	return config[ref] ?? config[model.provider];
}

function roleEntries(profile: Profile): Array<[string, ProfileEntry]> {
	return Object.entries(profile).filter(
		(entry): entry is [string, ProfileEntry] =>
			entry[0] !== "session" &&
			typeof entry[1] === "object" &&
			entry[1] !== null,
	);
}

interface AppliedLine {
	index: number;
	value: string;
}

function findOwnedLine(
	lines: readonly string[],
	prefix: string,
	expected: string | null | undefined,
): AppliedLine | undefined {
	if (expected === undefined) return undefined;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (!line.startsWith(prefix)) continue;
		const value = line.slice(prefix.length).trim();
		if (value === expected) return { index, value };
	}
	return undefined;
}

function findModelLine(
	lines: readonly string[],
	token: string,
	applied: AppliedEntry | undefined,
): AppliedLine | undefined {
	const tokenLine = findOwnedLine(lines, "model: ", token);
	if (tokenLine) return tokenLine;
	return findOwnedLine(lines, "model: ", applied?.model);
}

function findThinkingLine(
	lines: readonly string[],
	applied: AppliedEntry | undefined,
): AppliedLine | undefined {
	return findOwnedLine(lines, "thinking: ", applied?.thinking);
}

/** Index just after the frontmatter opening fence. */
function insertionIndex(lines: readonly string[]): number {
	return lines[0] === "---" ? 1 : 0;
}

/**
 * Rewrite one agent file's frontmatter so a role token resolves to the
 * target entry. Only lines carrying the token or a glue-applied value are
 * touched; hand-edited values stay untouched.
 */
export function applyProfileToFile(
	lines: string[],
	token: string,
	target: ProfileEntry,
	applied: AppliedEntry | undefined,
): { changed: boolean; next: AppliedEntry } {
	if (lines[0] !== "---") return { changed: false, next: {} };
	// The token lives in neither the file nor the glue's state: the file does
	// not carry this role, so inserting lines would corrupt its frontmatter.
	if (
		!findModelLine(lines, token, applied) &&
		applied?.model === undefined &&
		applied?.thinking === undefined
	) {
		return { changed: false, next: applied ?? {} };
	}

	let changed = false;
	const nextApplied: AppliedEntry = {};

	const modelLine = findModelLine(lines, token, applied);
	if (target.model) {
		if (modelLine) {
			const replacement = `model: ${target.model}`;
			if (lines[modelLine.index] !== replacement) {
				lines[modelLine.index] = replacement;
				changed = true;
			}
		} else {
			lines.splice(insertionIndex(lines), 0, `model: ${target.model}`);
			changed = true;
		}
		nextApplied.model = target.model;
	} else if (modelLine) {
		lines.splice(modelLine.index, 1);
		changed = true;
		nextApplied.model = null;
	} else if (applied?.model) {
		nextApplied.model = null;
	} else {
		nextApplied.model = undefined;
	}

	const thinkingLine = findThinkingLine(lines, applied);
	if (target.thinking) {
		if (thinkingLine) {
			const replacement = `thinking: ${target.thinking}`;
			if (lines[thinkingLine.index] !== replacement) {
				lines[thinkingLine.index] = replacement;
				changed = true;
			}
			nextApplied.thinking = target.thinking;
		} else if (!lines.some((line) => line.startsWith("thinking: "))) {
			const anchor = findModelLine(lines, token, applied);
			lines.splice(
				anchor ? anchor.index + 1 : insertionIndex(lines),
				0,
				`thinking: ${target.thinking}`,
			);
			changed = true;
			nextApplied.thinking = target.thinking;
		} else {
			// Hand-pinned thinking level wins; the glue does not own it.
			nextApplied.thinking = undefined;
		}
	} else if (thinkingLine) {
		lines.splice(thinkingLine.index, 1);
		changed = true;
		nextApplied.thinking = null;
	} else {
		nextApplied.thinking = undefined;
	}

	return { changed, next: nextApplied };
}

export async function applyAgentProfiles(
	model: Pick<Model<any>, "provider" | "id">,
	options: { agentDir?: string; config?: ProfileConfig } = {},
): Promise<void> {
	const config = options.config ?? loadProfileConfig();
	if (!config) return;

	const profile = profileFor(config, model);
	if (!profile) return;

	const dir = options.agentDir ?? agentDirPath();
	if (!existsSync(dir)) return;

	const stateFile = statePath(dir);
	let state: ProfileState = {};
	if (existsSync(stateFile)) {
		try {
			state = JSON.parse(await readFile(stateFile, "utf8")) as ProfileState;
		} catch {
			state = {};
		}
	}

	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".md")) continue;
		const path = join(dir, file);
		const lines = (await readFile(path, "utf8")).split("\n");
		if (!state[file]) state[file] = {};
		const fileState = state[file];
		let changed = false;

		for (const [token, target] of roleEntries(profile)) {
			const applied = fileState[token];
			const result = applyProfileToFile(lines, token, target, applied);
			if (result.changed) changed = true;
			fileState[token] = result.next;
		}

		if (changed) await writeFile(path, lines.join("\n"), "utf8");
	}

	await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// Mirrors pi-web-access getWebSearchConfigDir: PI_CODING_AGENT_DIR override,
// then XDG_CONFIG_HOME/pi (existing file preferred, legacy ~/.pi fallback).
function webSearchConfigPath(): string {
	const explicitDir = process.env.PI_CODING_AGENT_DIR?.trim();
	if (explicitDir) return join(explicitDir, "web-search.json");

	const xdgConfigHome = process.env.XDG_CONFIG_HOME;
	if (xdgConfigHome) {
		const xdgDir = join(xdgConfigHome, "pi");
		if (existsSync(join(xdgDir, "web-search.json")))
			return join(xdgDir, "web-search.json");
		const legacyDir = join(homedir(), ".pi");
		if (existsSync(join(legacyDir, "web-search.json")))
			return join(legacyDir, "web-search.json");
		return join(xdgDir, "web-search.json");
	}
	return join(homedir(), ".pi", "agent", "web-search.json");
}

function supportedLevels(map: LevelMap | undefined): Level[] | undefined {
	if (!map) return undefined;
	return LEVEL_ORDER.filter((level) => map[level] !== null);
}

async function followSummaryModel(model: Model<any>): Promise<void> {
	const path = webSearchConfigPath();
	let config: Record<string, unknown> = {};
	if (existsSync(path)) {
		try {
			config = JSON.parse(await readFile(path, "utf8")) as Record<
				string,
				unknown
			>;
		} catch {
			config = {};
		}
	}
	config.summaryModel = `${model.provider}/${model.id}`;
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function promptThinking(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	model: Model<any>,
): Promise<void> {
	if (!ctx.hasUI) return;

	const supported = supportedLevels(model.thinkingLevelMap as LevelMap);
	if (!supported || supported.length === 0) return;

	const current = ctx.thinkingLevel;
	if (current && supported.includes(current as Level)) return;

	// Infra-configured session thinking default wins; cancel applies it too.
	const config = loadProfileConfig();
	const profile = config ? profileFor(config, model) : undefined;
	const configured = profile?.session?.thinking as Level | undefined;
	const fallback =
		configured && supported.includes(configured) ? configured : undefined;

	const rest = PROMPT_ORDER.filter(
		(level) => supported.includes(level) && level !== fallback,
	);
	const options = fallback ? [fallback, ...rest] : rest;
	if (options.length === 0) return;

	const choice = await ctx.ui.select(
		"Thinking level:",
		options as unknown as string[],
	);
	// Cancel maps the unsupported medium default to the configured (or
	// strongest everyday) level instead of pi's downward clamp (deepseek ->
	// off).
	const level = (choice as Level | undefined) ?? fallback ?? options[0];
	if (level) pi.setThinkingLevel(level);
}

/**
 * Startup profile selection. Lists the configured profiles from
 * PI_SUITE_PROFILE_AGENTS; picking one sets the session model from
 * `session.model` when present (side effects then run through
 * model_select) or keeps the current default (profiles without a session
 * model). Cancel keeps the default untouched.
 */
async function pickStartupProfile(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const config = loadProfileConfig();
	if (!config || Object.keys(config).length === 0) return;

	const current = ctx.model;
	const entries: Array<{ key: string; model?: Model<any> }> = [];
	for (const key of Object.keys(config)) {
		const ref = config[key].session?.model;
		if (!ref) {
			entries.push({ key });
			continue;
		}
		const slashIndex = ref.indexOf("/");
		if (slashIndex === -1) continue;
		const model = ctx.modelRegistry.find(
			ref.slice(0, slashIndex),
			ref.slice(slashIndex + 1),
		);
		// Unauthenticated profiles are not selectable.
		if (model) entries.push({ key, model });
	}
	if (entries.length === 0) return;

	const options = entries.map((entry) => {
		const active =
			entry.model &&
			current &&
			current.provider === entry.model.provider &&
			current.id === entry.model.id;
		return `${entry.key}${active ? "  (active)" : ""}`;
	});
	const choice = await ctx.ui.select("Model profile:", options);
	if (!choice) return;

	const picked = entries[options.indexOf(choice)];
	if (!picked) return;

	if (picked.model) {
		const changed = await pi.setModel(picked.model);
		if (!changed) {
			ctx.ui.notify(
				`Could not switch to ${picked.model.provider}/${picked.model.id} — no auth configured`,
				"error",
			);
			return;
		}
		// setModel emits model_select, which runs the profile side effects.
		return;
	}

	// Provider-wide profile: keep the session model, apply side effects only.
	const model = ctx.model;
	if (!model) return;
	try {
		await followSummaryModel(model);
		await applyAgentProfiles(model);
	} catch {
		// Side effects are best-effort.
	}
}

function registerStartupProfileSelect(pi: ExtensionAPI): void {
	pi.on("session_start", async (event, ctx) => {
		if (event.reason !== "startup" || !ctx.hasUI) return;
		await pickStartupProfile(pi, ctx);
	});
}

export default function modelProfile(pi: ExtensionAPI): void {
	registerStartupProfileSelect(pi);

	pi.on("model_select", async (event, ctx) => {
		// Restores replay the session's own model/level choices.
		if (event.source === "restore") return;

		try {
			await followSummaryModel(event.model);
			await applyAgentProfiles(event.model);
		} catch {
			// Profile side effects are best-effort; never block the model switch.
		}

		await promptThinking(pi, ctx, event.model);
	});
}
