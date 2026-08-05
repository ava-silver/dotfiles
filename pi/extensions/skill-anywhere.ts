// Invoke skills (and get autocomplete) anywhere in a prompt, not just at the start.
//
// pi only offers `/skill:` autocomplete at the start of a line. This extension adds
// an autocomplete provider that completes `/skill:` tokens anywhere in a prompt.
//
// The `/skill:name` token is left inline as literal text -- the agent already has every
// skill's name, description, and location in its system prompt, so a bare token is a
// sufficient signal to load the skill. We deliberately do NOT paste the full skill body
// mid-prompt (that bloats the UI); the start-of-prompt case is still handled by pi's
// built-in expansion.

import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	loadSkills,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	Editor,
	fuzzyFilter,
} from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_SUGGESTIONS = 20;

// The editor only auto-shows the slash menu when `/` is the first non-whitespace
// character on the line; mid-line `/` requires pressing Tab because the editor
// deliberately drops `/` from its auto-trigger characters. Patch the exported
// Editor prototype so `/` also auto-triggers mid-line (after whitespace), matching
// the start-of-line experience. Idempotent and applied once per process.
function patchEditorTriggerSlash(): void {
	const proto = Editor.prototype as unknown as {
		__skillAnywherePatched?: boolean;
		setAutocompleteTriggerCharacters(chars: string[]): void;
		autocompleteTriggerCharacters: string[];
		autocompleteTriggerPattern: RegExp;
	};
	if (proto.__skillAnywherePatched) return;
	proto.__skillAnywherePatched = true;

	const original = proto.setAutocompleteTriggerCharacters;
	const escapeCharClass = (value: string) => value.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
	proto.setAutocompleteTriggerCharacters = function (chars: string[]): void {
		original.call(this, chars);
		if (!this.autocompleteTriggerCharacters.includes("/")) {
			this.autocompleteTriggerCharacters.push("/");
		}
		const cls = this.autocompleteTriggerCharacters.map(escapeCharClass).join("");
		this.autocompleteTriggerPattern = new RegExp(`(?:^|[\\s])[${cls}][^\\s]*$`);
	};
}

// Matches a space-then-`/<query>` token immediately before the cursor (query may be empty).
// The leading whitespace requirement means start-of-line `/` is left to pi's built-in
// command menu; this only fires mid-prompt. An explicit `skill:` is optional.
const SKILL_PREFIX_AT_CURSOR = /\s(\/(?:skill:)?([A-Za-z0-9_.-]*))$/;

function collectSkillDirs(cwd: string): string[] {
	const dirs: string[] = [join(homedir(), ".agents", "skills")];

	// Walk from cwd up to the git repo root (or filesystem root) collecting
	// project-local skill dirs, matching pi's discovery rules.
	let dir = cwd;
	while (true) {
		dirs.push(join(dir, CONFIG_DIR_NAME, "skills"));
		dirs.push(join(dir, ".agents", "skills"));
		if (existsSync(join(dir, ".git"))) break;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return dirs.filter((d) => existsSync(d));
}

function loadSkillMap(cwd: string, projectTrusted: boolean): Map<string, Skill> {
	const agentDir = getAgentDir();
	const configuredSkillPaths = SettingsManager.create(cwd, agentDir, { projectTrusted }).getSkillPaths();
	const { skills } = loadSkills({
		cwd,
		agentDir,
		skillPaths: [...collectSkillDirs(cwd), ...configuredSkillPaths],
		includeDefaults: true,
	});
	const map = new Map<string, Skill>();
	for (const skill of skills) {
		if (!map.has(skill.name)) map.set(skill.name, skill);
	}
	return map;
}

function createSkillAutocompleteProvider(
	current: AutocompleteProvider,
	getSkills: () => Map<string, Skill>,
): AutocompleteProvider {
	return {
		triggerCharacters: [...(current.triggerCharacters ?? []), "/"],

		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol);
			const match = before.match(SKILL_PREFIX_AT_CURSOR);
			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const prefix = match[1]; // "/<query>" or "/skill:<query>"
			const query = match[2] ?? "";
			const skills = [...getSkills().values()];
			const filtered = (query.trim()
				? fuzzyFilter(skills, query, (s) => s.name)
				: skills
			).slice(0, MAX_SUGGESTIONS);

			if (filtered.length === 0) return null;

			return {
				items: filtered.map<AutocompleteItem>((s) => ({
					value: `/skill:${s.name}`,
					label: `/skill:${s.name}`,
					description: s.description,
				})),
				prefix,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!item.value.startsWith("/skill:")) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol);
			const insert = `${item.value} `;
			const newLines = [...lines];
			newLines[cursorLine] = `${before}${insert}${after}`;
			return { lines: newLines, cursorLine, cursorCol: before.length + insert.length };
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export default function (pi: ExtensionAPI): void {
	let skillMap = new Map<string, Skill>();

	const refresh = (cwd: string, projectTrusted: boolean) => {
		try {
			skillMap = loadSkillMap(cwd, projectTrusted);
		} catch {
			// Leave the previous map in place on failure.
		}
	};

	patchEditorTriggerSlash();

	pi.on("session_start", async (_event, ctx) => {
		refresh(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.addAutocompleteProvider((current) => createSkillAutocompleteProvider(current, () => skillMap));
	});

	pi.on("resources_discover", async (event, ctx) => {
		refresh(event.cwd, ctx.isProjectTrusted());
	});
}
