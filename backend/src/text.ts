import type { MessageContent } from "@langchain/core/messages";

export function extractText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }
  let text = "";
  for (const block of content) {
    if (block["type"] === "text" && typeof block["text"] === "string") {
      text += block["text"];
    }
  }
  return text;
}
