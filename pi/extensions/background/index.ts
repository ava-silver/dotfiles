import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, matchesKey, type EditorComponent } from "@earendil-works/pi-tui";
import { BackgroundHub } from "./src/hub.ts";
import { setupSubagents } from "./subagents.ts";
import { setupTerminals } from "./terminals.ts";

export default function (pi: ExtensionAPI) {
	const background = new BackgroundHub();
	setupSubagents(pi, background);
	setupTerminals(pi, background);

	pi.registerCommand("background", {
		description: "List and inspect background tasks",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("Background task details are only available in the TUI", "error");
				return;
			}
			await background.openPicker(ctx);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		let picker: Promise<void> | undefined;
		const openPicker = () => {
			if (!background.hasAnyItems() || picker) return;
			picker = background
				.openPicker(ctx)
				.catch((error) => ctx.ui.notify(`Could not open background tasks: ${String(error)}`, "error"))
				.finally(() => {
					picker = undefined;
				});
		};

		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings);
			if (editor instanceof Editor) {
				const handleInput = editor.handleInput.bind(editor);
				editor.handleInput = (data: string) => {
					if (matchesKey(data, "down") && !editor.isShowingAutocomplete()) {
						const lines = editor.getLines();
						const cursor = editor.getCursor();
						const atBottom = lines.length === 1 && lines[0] === "" && cursor.line === 0 && cursor.col === 0;
						if (atBottom && background.hasAnyItems()) {
							openPicker();
							return;
						}
					}
					handleInput(data);
				};
			}
			return editor as EditorComponent;
		});
	});
}
