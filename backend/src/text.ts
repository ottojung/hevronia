import { AIMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";

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

export function extractReplyText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message === undefined) {
      continue;
    }
    if (message instanceof AIMessage) {
      const text = extractText(message.content).trim();
      if (text) {
        return text;
      }
    }
  }
  throw new Error("Agent returned no text reply");
}
