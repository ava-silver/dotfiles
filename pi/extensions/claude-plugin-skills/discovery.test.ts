import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { claudePluginSkillPrompt, discoverClaudePluginSkills } from "./discovery.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function createSkill(root: string, name: string): string {
	const directory = join(root, "skills", name);
	mkdirSync(directory, { recursive: true });
	const path = join(directory, "SKILL.md");
	writeFileSync(path, `---\nname: ${name}\ndescription: Test ${name}\n---\n\nRun it.\n`);
	return path;
}

test("discovers the newest installation of each enabled Claude plugin", async () => {
	const home = await mkdtemp(join(tmpdir(), "claude-plugin-skills-"));
	tempDirs.push(home);
	const oldRoot = join(home, "old");
	const newRoot = join(home, "new");
	createSkill(oldRoot, "old-skill");
	const skillPath = createSkill(newRoot, "go-review");
	mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "plugins", "installed_plugins.json"),
		JSON.stringify({
			plugins: {
				"go-reviewer@example": [
					{ installPath: oldRoot, lastUpdated: "2026-01-01" },
					{ installPath: newRoot, lastUpdated: "2026-02-01" },
				],
			},
		}),
	);

	const skills = discoverClaudePluginSkills(home, home);

	assert.equal(skills.length, 1);
	assert.equal(skills[0]?.name, "go-review");
	assert.equal(skills[0]?.filePath, skillPath);
	assert.equal(skills[0]?.pluginRoot, newRoot);
});

test("excludes installations scoped to another project", async () => {
	const home = await mkdtemp(join(tmpdir(), "claude-plugin-skills-"));
	tempDirs.push(home);
	const project = join(home, "project");
	const otherProject = join(home, "other-project");
	const pluginRoot = join(home, "plugin");
	createSkill(pluginRoot, "go-review");
	mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "plugins", "installed_plugins.json"),
		JSON.stringify({
			plugins: {
				"go-reviewer@example": [{ installPath: pluginRoot, scope: "project", projectPath: otherProject }],
			},
		}),
	);

	assert.deepEqual(discoverClaudePluginSkills(project, home), []);
});

test("honors project-level disabled plugins", async () => {
	const home = await mkdtemp(join(tmpdir(), "claude-plugin-skills-"));
	tempDirs.push(home);
	const project = join(home, "project");
	const pluginRoot = join(home, "plugin");
	createSkill(pluginRoot, "go-review");
	mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
	mkdirSync(join(project, ".claude"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "plugins", "installed_plugins.json"),
		JSON.stringify({ plugins: { "go-reviewer@example": [{ installPath: pluginRoot }] } }),
	);
	writeFileSync(
		join(project, ".claude", "settings.json"),
		JSON.stringify({ enabledPlugins: { "go-reviewer@example": false } }),
	);

	assert.deepEqual(discoverClaudePluginSkills(project, home), []);
});

test("builds a Pi-compatible invocation prompt", () => {
	const prompt = claudePluginSkillPrompt(
		{
			name: "go-review",
			description: "Review Go",
			filePath: "/plugin/skills/go-review/SKILL.md",
			baseDir: "/plugin/skills/go-review",
			sourceInfo: { path: "/plugin/skills/go-review/SKILL.md", source: "test", scope: "user", origin: "top-level" },
			disableModelInvocation: true,
			pluginId: "go-reviewer@example",
			pluginRoot: "/plugin",
		},
		"./pkg",
	);

	assert.match(prompt, /subagent_spawn instead of Task/);
	assert.match(prompt, /Plugin agents directory: \/plugin\/agents/);
	assert.match(prompt, /User request: \.\/pkg/);
});
