import {
	copyToClipboard,
	CustomEditor,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		class CopyingEditor extends CustomEditor {
			handleInput(data: string): void {
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
			new CopyingEditor(tui, theme, keybindings),
		);
	});
}
