import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ConversationLayer, ConversationLayerOptions, RespondInput } from "./conversation-types.js";
import { createConversationStore } from "./conversation-store.js";
import { GeneratedTurn } from "./generated-turn.js";
import { recallForTurn, rememberDeliveredUserMessage } from "./long-term-memory/operations.js";
import { PendingMemoryWrites } from "./long-term-memory/pending.js";
import { MODEL, openAiKeyFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { createSocialDecisionMaker } from "./social-decision.js";
import { COMPACTION, DEFAULT_DB_PATH } from "./summary.js";
import { extractText } from "./text.js";
import type { DeliveredHevroniaMessage } from "./telegram-event.js";
import { realizationContext, replyCandidates } from "./turn-context.js";

export class InvalidRealizationResponseError extends Error {
  constructor() {
    super("Realization model returned no Telegram message");
    this.name = "InvalidRealizationResponseError";
  }
}

export function isInvalidRealizationResponseError(error: unknown): error is InvalidRealizationResponseError {
  return error instanceof InvalidRealizationResponseError;
}

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const personality = options.systemPrompt ?? SYSTEM_PROMPT;
  const pending = options.pendingMemoryWrites ?? new PendingMemoryWrites();
  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  const model = options.model ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(), model: MODEL });
  const summaryModel = options.summaryModel ?? new ChatOpenAI({
    apiKey: openAiKeyFromEnv(), model: MODEL, temperature: 0,
  });
  const store = createConversationStore(checkpointer, {
    summaryModel,
    triggerTokens: options.triggerTokens ?? COMPACTION.triggerTokens,
    keepTokens: options.keepTokens ?? COMPACTION.keepTokens,
    trimTokensToSummarize: options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize,
    tokenCounter: options.tokenCounter,
  });
  const planner = options.decisionMaker ?? createSocialDecisionMaker(model, personality);

  return {
    async respond(input: RespondInput): Promise<GeneratedTurn> {
      await store.append(input.threadId, input.message);
      const history = await store.getMessages(input.threadId);
      const recalled = await recallForTurn(options.longTermMemory, input.userId, input.message.text);
      const candidates = replyCandidates(history);
      let decision: Awaited<ReturnType<typeof planner.decide>>;
      try {
        decision = await planner.decide({
          boundedHistory: history,
          currentMessage: input.message,
          replyCandidates: candidates,
          recalledMemories: recalled,
        });
      } catch (error) {
        console.warn(`Social decision failed safely to silence: ${String(error)}`);
        decision = { action: "silence" };
      }
      const rememberIncoming = () => rememberDeliveredUserMessage(
        options.longTermMemory, input.userId, input.threadId, input.message.text,
      );
      if (decision.action === "silence") {
        return GeneratedTurn.fromSilence(rememberIncoming, pending);
      }
      const target = candidates.find(({ key }) => key === decision.targetCandidateKey);
      if (target === undefined) {
        return GeneratedTurn.fromSilence(rememberIncoming, pending);
      }
      const response = await model.invoke([
        new SystemMessage(personality),
        new HumanMessage(realizationContext(history, recalled, decision)),
      ]);
      if (!isBaseMessage(response)) {
        throw new InvalidRealizationResponseError();
      }
      const replyText = extractText(response.content).trim();
      if (!replyText) {
        throw new InvalidRealizationResponseError();
      }
      return GeneratedTurn.fromReply(replyText, target.messageId, async (messageId) => {
        const delivered: DeliveredHevroniaMessage = {
          kind: "hevronia", messageId, senderId: input.hevroniaSenderId,
          senderDisplayName: "Хевронія", chatKind: input.message.chatKind,
          text: replyText, replyToMessageId: target.messageId,
        };
        await store.append(input.threadId, delivered);
        await rememberIncoming();
      }, pending);
    },
    getMessages: store.getMessages,
    async close(): Promise<void> {
      await pending.drain();
      checkpointer.db.close();
    },
  };
}
