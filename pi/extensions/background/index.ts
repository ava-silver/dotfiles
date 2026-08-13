import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupSubagents } from "./subagents.ts";
import { setupTerminals } from "./terminals.ts";

export default function (pi: ExtensionAPI) {
	setupSubagents(pi);
	setupTerminals(pi);
}
