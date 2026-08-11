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
			private yankStack: string[] = [];

			handleInput(data: string): void {
				// Ctrl+U / Cmd+Delete / Option+Delete: push content before the kill
				if (matchesKey(data, "ctrl+u") || matchesKey(data, "alt+backspace")) {
					const text = ctx.ui.getEditorText();
					if (text) this.yankStack.push(text);
					super.handleInput(data);
					this.tui.requestRender();
					return;
				}

				// Cmd+Z (via Zed terminal → ESC+Z) or Ctrl+Y: pop and restore
				if (data === "\x1bZ" || matchesKey(data, "ctrl+y")) {
					const text = this.yankStack.pop();
					if (text !== undefined) {
						ctx.ui.setEditorText(text);
						this.tui.requestRender();
					}
					return;
				}

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
							this.tui.requestRender();
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
