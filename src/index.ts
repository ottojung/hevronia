import { startBot } from "./telegram.js";
import { closeConversationLayer, getConversationLayer, openAiKeyFromEnv } from "./respond.js";

async function main(): Promise<void> {
  try {
    openAiKeyFromEnv();
    getConversationLayer();
    await startBot();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${detail}`);
    process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeConversationLayer().catch(() => undefined);
  });
}

void main();
