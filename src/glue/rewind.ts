import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { importUpstream } from "../upstream.js";

const EXTRA_IGNORED_DIRECTORIES = [
	// keep-sorted start
	".direnv",
	".git",
	".rumdl_cache",
	"target",
	"vendor",
	// keep-sorted end
];

export default async function rewindAdapter(pi: ExtensionAPI): Promise<void> {
	const [extension, core] = await Promise.all([
		importUpstream("pi-rewind/src/index.js"),
		importUpstream("pi-rewind/src/core.js"),
	]);
	const ignored = core.IGNORED_DIR_NAMES as Set<string>;
	for (const name of EXTRA_IGNORED_DIRECTORIES) ignored.add(name);
	await extension.default(pi);
}
