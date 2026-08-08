import { startBot } from "./telegram.js";

async function main(): Promise<void> {
  try {
    await startBot();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${detail}`);
    process.exitCode = 1;
  }
}

void main();
