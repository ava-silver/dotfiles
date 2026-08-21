import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.registerShortcut("ctrl+n", {
		description: 'Send "continue" to the agent',
		handler: async (ctx) => {
			if (ctx.isIdle()) {
				pi.sendUserMessage("continue");
			} else {
				pi.sendUserMessage("continue", { deliverAs: "followUp" });
			}
		},
	});
}
