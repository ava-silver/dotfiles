import {
	copyToClipboard,
	CustomEditor,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

interface EscapeEscalationRequest {
	handled: boolean;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		class KeyHandlingEditor extends CustomEditor {
			handleInput(data: string): void {
				if (matchesKey(data, "escape")) {
					const request: EscapeEscalationRequest = { handled: false };
					pi.events.emit("shell-signal-escalation:escape", request);
					if (request.handled) return;
				}

				if (data === "ç") {
					const prompt = ctx.ui.getEditorText();
					if (!prompt.trim()) return;

					void copyToClipboard(prompt)
						.then(() => {
							ctx.ui.setEditorText("");
						})
						.catch((error: unknown) => {
							ctx.ui.notify(`Could not copy prompt: ${String(error)}`, "error");
						});
					return;
				}

				super.handleInput(data);
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new KeyHandlingEditor(tui, theme, keybindings),
		);
	});
}
