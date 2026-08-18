import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";

interface InstalledPlugin {
	installPath?: string;
	installedAt?: string;
	lastUpdated?: string;
	projectPath?: string;
	scope?: "project" | "user";
}

interface InstalledPluginsFile {
	plugins?: Record<string, InstalledPlugin[]>;
}

interface ClaudeSettings {
	enabledPlugins?: Record<string, boolean>;
}

export interface ClaudePluginSkill extends Skill {
	pluginId: string;
	pluginRoot: string;
}

function readJson<T>(path: string): T | undefined {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function projectSettingsPaths(cwd: string): string[] {
	const paths: string[] = [];
	let current = cwd;
	while (true) {
		paths.unshift(join(current, ".claude", "settings.json"));
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return paths;
}

function disabledPlugins(cwd: string, home: string): Set<string> {
	const enabled = new Map<string, boolean>();
	for (const path of [join(home, ".claude", "settings.json"), ...projectSettingsPaths(cwd)]) {
		const settings = readJson<ClaudeSettings>(path);
		for (const [plugin, value] of Object.entries(settings?.enabledPlugins ?? {})) enabled.set(plugin, value);
	}
	return new Set([...enabled].filter(([, value]) => !value).map(([plugin]) => plugin));
}

function appliesToProject(installation: InstalledPlugin, cwd: string): boolean {
	if (installation.scope !== "project") return true;
	if (!installation.projectPath) return false;
	const pathFromProject = relative(installation.projectPath, cwd);
	return pathFromProject === "" || (!pathFromProject.startsWith("..") && !isAbsolute(pathFromProject));
}

function newestInstallation(installations: InstalledPlugin[], cwd: string): InstalledPlugin | undefined {
	return installations
		.filter((installation) => installation.installPath && appliesToProject(installation, cwd))
		.toSorted((a, b) => (b.lastUpdated ?? b.installedAt ?? "").localeCompare(a.lastUpdated ?? a.installedAt ?? ""))[0];
}

export function discoverClaudePluginSkills(cwd: string, home: string): ClaudePluginSkill[] {
	const installed = readJson<InstalledPluginsFile>(join(home, ".claude", "plugins", "installed_plugins.json"));
	const disabled = disabledPlugins(cwd, home);
	const skills: ClaudePluginSkill[] = [];

	for (const [pluginId, installations] of Object.entries(installed?.plugins ?? {})) {
		if (disabled.has(pluginId)) continue;
		const installation = newestInstallation(installations, cwd);
		if (!installation?.installPath) continue;
		const pluginRoot = installation.installPath;
		const skillDir = join(pluginRoot, "skills");
		if (!existsSync(skillDir)) continue;
		const loaded = loadSkillsFromDir({ dir: skillDir, source: `claude-plugin:${pluginId}` });
		for (const skill of loaded.skills) skills.push({ ...skill, pluginId, pluginRoot });
	}

	return skills;
}

export function claudePluginSkillPrompt(skill: ClaudePluginSkill, args: string): string {
	const agentsDir = join(skill.pluginRoot, "agents");
	return [
		`Load and follow the Claude plugin skill [${skill.name}](${skill.filePath}).`,
		"Adapt Claude Code-specific instructions to Pi. Use subagent_spawn instead of Task. When the skill names a subagent type, read its prompt from the plugin's agents directory and include those instructions in the spawned agent prompt.",
		`Plugin agents directory: ${agentsDir}`,
		args ? `User request: ${args}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}
