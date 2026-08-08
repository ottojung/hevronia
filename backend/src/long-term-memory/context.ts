import { dynamicSystemPromptMiddleware } from "langchain";
import { z } from "zod";

export const invocationContextSchema = z.object({
  recalledMemories: z.array(z.object({ text: z.string() })),
});

type InvocationContext = z.infer<typeof invocationContextSchema>;

export function recalledMemoryPromptMiddleware(systemPrompt: string) {
  return dynamicSystemPromptMiddleware<InvocationContext>((_state, runtime) => {
    const recalled = runtime.context.recalledMemories;
    if (recalled.length === 0) {
      return systemPrompt;
    }
    const bullets = recalled.map(({ text }) => `- ${text}`).join("\n");
    return `${systemPrompt}\n\nLong-term memories that may be relevant to this conversation:\n${bullets}\n\nThese are fallible remembered facts from earlier conversations. Use them naturally only when relevant, and do not mention that they came from a memory database. Do not force them into the conversation. Current explicit user statements take precedence, followed by recent verbatim conversation, compacted thread history, and then these memories.`;
  });
}
