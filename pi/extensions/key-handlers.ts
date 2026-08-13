import { copyToClipboard, CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { EditorComponent } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";

interface EscapeEscalationRequest {
	handled: boolean;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			const handleInput = editor.handleInput.bind(editor);
			const yankStack: string[] = [];

			editor.handleInput = (data: string) => {
				if (matchesKey(data, "ctrl+u") || matchesKey(data, "alt+backspace")) {
					const text = ctx.ui.getEditorText();
					if (text) yankStack.push(text);
					handleInput(data);
					tui.requestRender();
					return;
				}

				if (data === "\x1bZ" || matchesKey(data, "ctrl+shift+z") || matchesKey(data, "ctrl+y")) {
					const text = yankStack.pop();
					if (text !== undefined) {
						ctx.ui.setEditorText(text);
						tui.requestRender();
					}
					return;
				}

				if (matchesKey(data, "escape")) {
					const request: EscapeEscalationRequest = { handled: false };
					pi.events.emit("shell-signal-escalation:escape", request);
					if (request.handled) return;
				}

				if (matchesKey(data, "alt+c") || data === "ç") {
					const prompt = ctx.ui.getEditorText();
					if (!prompt.trim()) return;

					void copyToClipboard(prompt)
						.then(() => {
							ctx.ui.setEditorText("");
							tui.requestRender();
						})
						.catch((error: unknown) => {
							ctx.ui.notify(`Could not copy prompt: ${String(error)}`, "error");
						});
					return;
				}

				handleInput(data);
			};

			return editor as EditorComponent;
		});
	});
}
