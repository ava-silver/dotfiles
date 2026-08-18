import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { claudePluginSkillPrompt, discoverClaudePluginSkills } from "./discovery.ts";

export default function (pi: ExtensionAPI): void {
	const skills = discoverClaudePluginSkills(process.cwd(), homedir());
	const registered = new Set<string>();

	for (const skill of skills) {
		if (!skill.disableModelInvocation || registered.has(skill.name)) continue;
		registered.add(skill.name);
		pi.registerCommand(skill.name, {
			description: skill.description,
			handler: async (args) => {
				pi.sendUserMessage(claudePluginSkillPrompt(skill, args));
			},
		});
	}

	pi.on("resources_discover", () => ({
		skillPaths: [...new Set(skills.map((skill) => skill.filePath))],
	}));
}
