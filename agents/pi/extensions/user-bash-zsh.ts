// Run user `!` / `!!` shell commands with zsh instead of bash.
//
// pi's `shellPath` setting would switch the shell globally, including the agent's
// `bash` tool. This extension scopes the change to user-initiated `!` commands only,
// leaving the agent's bash tool on the default shell.

import { createLocalBashOperations, type BashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";

// Set to true to source ~/.zshrc before each command (aliases/functions/env).
// Off by default: `zsh -c` is non-interactive, and sourcing an interactive
// ~/.zshrc (p10k instant prompt, etc.) can emit noise or errors.
const SOURCE_ZSHRC = false;

function resolveZshPath(): string | undefined {
	const candidates = [
		process.env.SHELL && /\/zsh$/.test(process.env.SHELL) ? process.env.SHELL : undefined,
		"/bin/zsh",
		"/usr/bin/zsh",
		"/opt/homebrew/bin/zsh",
		"/usr/local/bin/zsh",
	].filter((p): p is string => Boolean(p));
	return candidates.find((p) => existsSync(p));
}

export default function (pi: ExtensionAPI): void {
	const zshPath = resolveZshPath();
	let ops: BashOperations | undefined;

	pi.on("user_bash", () => {
		if (!zshPath) return; // No zsh found; fall back to pi's default shell.

		if (!ops) {
			const zsh = createLocalBashOperations({ shellPath: zshPath });
			ops = SOURCE_ZSHRC
				? {
						exec: (command, cwd, options) =>
							zsh.exec(`source ~/.zshrc 2>/dev/null; ${command}`, cwd, options),
					}
				: zsh;
		}

		return { operations: ops };
	});
}
