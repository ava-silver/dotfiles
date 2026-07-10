import { describe, expect, test } from "bun:test";
import {
	extractLatestAssistantText,
	normalizeForSpeech,
	parseHidIdleMs,
	parseRate,
	parseScreenLocked,
} from "../read-aloud.ts";

describe("extractLatestAssistantText", () => {
	test("reads the latest completed assistant text in content order", () => {
		const result = extractLatestAssistantText([
			{
				id: "older",
				type: "message",
				message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Older" }] },
			},
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "Question" }] } },
			{
				id: "latest",
				type: "message",
				message: {
					role: "assistant",
					stopReason: "stop",
					content: [
						{ type: "thinking", thinking: "Private" },
						{ type: "text", text: "First" },
						{ type: "toolCall", name: "read" },
						{ type: "text", text: "Second" },
					],
				},
			},
		]);

		expect(result).toEqual({ status: "found", entryId: "latest", text: "First\nSecond" });
	});

	test("does not fall back past an incomplete latest response", () => {
		const result = extractLatestAssistantText([
			{
				type: "message",
				message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Older" }] },
			},
			{
				type: "message",
				message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "Working" }] },
			},
		]);

		expect(result).toEqual({ status: "incomplete", stopReason: "toolUse" });
	});

	test("reports no assistant response", () => {
		expect(extractLatestAssistantText([{ type: "message", message: { role: "user", content: [] } }])).toEqual({
			status: "missing",
		});
	});
});

describe("normalizeForSpeech", () => {
	test("keeps prose while removing Markdown destinations and code bodies", () => {
		const markdown = `# Result

Read [the docs](https://example.com/docs) and use \`ctrl+r\`.

\`\`\`ts
console.log("do not read");
\`\`\`

- Done at https://example.com/raw`;

		expect(normalizeForSpeech(markdown)).toBe("Result Read the docs and use ctrl+r. Done at");
	});

	test("turns table cells into pauses and removes separators", () => {
		const markdown = `| Name | Value |
| --- | --- |
| Speed | Fast |`;
		expect(normalizeForSpeech(markdown)).toBe("Name, Value. Speed, Fast.");
	});

	test("removes variable-length fenced code blocks", () => {
		const markdown = `Before

\`\`\`\`markdown
\`\`\`ts
secret
\`\`\`
\`\`\`\`

After

~~~~~
also secret
~~~~~`;
		expect(normalizeForSpeech(markdown)).toBe("Before After");
	});

	test("removes balanced link destinations", () => {
		expect(normalizeForSpeech("See [nested](https://x/a_(b)) next.")).toBe("See nested next.");
	});
});

describe("presence parsing", () => {
	test("converts HID nanoseconds to milliseconds", () => {
		expect(parseHidIdleMs('"HIDIdleTime" = 67547125')).toBeCloseTo(67.547125);
		expect(parseHidIdleMs("missing")).toBeUndefined();
	});

	test("parses screen lock state fail-closed", () => {
		expect(parseScreenLocked('"IOConsoleLocked" = No')).toBe(false);
		expect(parseScreenLocked('"IOConsoleLocked" = Yes')).toBe(true);
		expect(parseScreenLocked("missing")).toBeUndefined();
	});
});

describe("parseRate", () => {
	test("accepts only whole WPM values in range", () => {
		expect(parseRate("300")).toBe(300);
		expect(parseRate(" 450 ")).toBe(450);
		expect(parseRate("79")).toBeUndefined();
		expect(parseRate("601")).toBeUndefined();
		expect(parseRate("1.5")).toBeUndefined();
	});
});
