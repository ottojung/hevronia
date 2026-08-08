import { readFileSync } from "node:fs";

import { startBot } from "./telegram.js";
import { closeConversationLayer, initializeConversationLayer } from "./memory.js";

function readVersion(): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // fall through
  }
  return "unknown";
}

async function main(): Promise<void> {
  try {
    initializeConversationLayer();
    await startBot();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Fatal error: ${detail}`);
    process.exitCode = 1;
  } finally {
    await closeConversationLayer().catch(() => undefined);
  }
}

const argument = process.argv[2];
if (argument === "--version" || argument === "-v") {
  console.log(`hevronia ${readVersion()}`);
} else if (argument === "--help" || argument === "-h") {
  console.log("Usage: hevronia [--version] [--help]");
} else {
  void main();
}
