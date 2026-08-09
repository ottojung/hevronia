import type { ConversationThreadId, LongTermMemoryUserId } from "../../src/identifiers.js";
import { longTermMemoryUserIdFromTelegramSender } from "../../src/identifiers.js";
import type {
  LazyLongTermMemory,
  LongTermMemoryTurn,
} from "../../src/long-term-memory/runtime.js";
import { PARTICIPANT_ID } from "./identities.js";

/**
 * A deterministic lazy-memory implementation for the conversation harness.
 * The scenario's declared facts are immediately available in the first turn's
 * snapshot, so seeded scenarios do not depend on asynchronous background warmup.
 */
export class PreseededLazyMemory implements LazyLongTermMemory {
  private readonly participantUserId: LongTermMemoryUserId;

  constructor(private readonly facts: readonly string[]) {
    this.participantUserId = longTermMemoryUserIdFromTelegramSender(PARTICIPANT_ID);
  }

  beginTurn(): LongTermMemoryTurn {
    const facts = this.facts;
    const participantUserId = this.participantUserId;
    return {
      snapshot: {
        memoriesFor(userId: LongTermMemoryUserId): readonly { text: string }[] {
          return userId.toPersistenceKey() === participantUserId.toPersistenceKey()
            ? facts.map((text) => ({ text }))
            : [];
        },
      },
      release(): void {},
    };
  }

  warmUser(_userId: LongTermMemoryUserId): void {}

  observeUserMessage(
    _userId: LongTermMemoryUserId,
    _threadId: ConversationThreadId,
    _text: string,
  ): void {}

  close(): Promise<void> {
    return Promise.resolve();
  }
}
