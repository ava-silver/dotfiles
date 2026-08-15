import { Editor } from "@earendil-works/pi-tui";

type CompatibleEditorPrototype = {
	__skillAnywherePatched?: boolean;
	setAutocompleteTriggerCharacters(chars: string[]): void;
	autocompleteTriggerCharacters: string[];
	autocompleteTriggerPattern: RegExp;
};

/** Add `/` to Pi's private editor trigger list until the public API handles mid-line triggers. */
export function installMidLineSlashTrigger(): void {
	const prototype = Editor.prototype as unknown as CompatibleEditorPrototype;
	if (prototype.__skillAnywherePatched) return;

	// The wrapper invokes this private method with the active editor receiver.
	// oxlint-disable-next-line typescript/unbound-method
	const setTriggers = prototype.setAutocompleteTriggerCharacters;
	if (typeof setTriggers !== "function") {
		throw new Error("The installed Pi TUI does not support the skill-anywhere editor compatibility patch.");
	}

	prototype.__skillAnywherePatched = true;
	const escapeCharClass = (value: string) => value.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
	prototype.setAutocompleteTriggerCharacters = function (this: CompatibleEditorPrototype, chars: string[]): void {
		setTriggers.call(this, chars);
		if (!this.autocompleteTriggerCharacters.includes("/")) this.autocompleteTriggerCharacters.push("/");
		const characters = this.autocompleteTriggerCharacters.map(escapeCharClass).join("");
		this.autocompleteTriggerPattern = new RegExp(`(?:^|[\\s])[${characters}][^\\s]*$`);
	};
}
