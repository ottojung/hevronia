import { HumanMessage, SystemMessage, isBaseMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type { ConversationLayer, ConversationLayerOptions, RespondInput } from "./conversation-types.js";
import { createConversationStore } from "./conversation-store.js";
import { GeneratedTurn } from "./generated-turn.js";
import { memoryUserIdForSender, scheduleRememberedMessage } from "./long-term-memory/operations.js";
import { PendingMemoryWrites } from "./long-term-memory/pending.js";
import { PendingConversationWrites } from "./pending-conversation-writes.js";
import { memoriesForTarget, recallForCandidates } from "./participant-memory.js";
import { MODEL, openAiKeyFromEnv } from "./model.js";
import { SYSTEM_PROMPT } from "./personality.js";
import { createSocialDecisionMaker } from "./social-decision.js";
import { COMPACTION, DEFAULT_DB_PATH } from "./summary.js";
import { extractText } from "./text.js";
import { InvalidRealizationResponseError, deliveredEvent, realizationContext,
  replyCandidates, replyRelationship, resolveDecision } from "./turn-context.js";

export function createConversationLayer(options: ConversationLayerOptions = {}): ConversationLayer {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const personality = options.systemPrompt ?? SYSTEM_PROMPT;
  const pending = options.pendingMemoryWrites ?? new PendingMemoryWrites();
  mkdirSync(dirname(dbPath), { recursive: true });
  const checkpointer = SqliteSaver.fromConnString(dbPath);
  const model = options.model ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(), model: MODEL });
  const summaryModel = options.summaryModel ?? new ChatOpenAI({ apiKey: openAiKeyFromEnv(),
    model: MODEL, temperature: 0 });
  const store = options.conversationStore ?? createConversationStore(checkpointer, {
    summaryModel,
    triggerTokens: options.triggerTokens ?? COMPACTION.triggerTokens,
    keepTokens: options.keepTokens ?? COMPACTION.keepTokens,
    trimTokensToSummarize: options.trimTokensToSummarize ?? COMPACTION.trimTokensToSummarize,
    tokenCounter: options.tokenCounter,
  });
  const planner = options.decisionMaker ?? createSocialDecisionMaker(model, personality);
  const canonicalWrites = options.pendingConversationWrites ?? new PendingConversationWrites();

  return {
    async respond(input: RespondInput): Promise<GeneratedTurn> {
      await canonicalWrites.submitAndWait(
        input.threadId, () => store.append(input.threadId, input.message),
      );
      const history = await store.getMessages(input.threadId);
      const userId = memoryUserIdForSender(input.message.sender);
      const candidates = replyCandidates(history);
      const participantMemories = await recallForCandidates(options.longTermMemory, candidates);
      let decision: Awaited<ReturnType<typeof planner.decide>>;
      try {
        decision = await planner.decide({
          boundedHistory: history, currentMessage: input.message,
          replyCandidates: candidates, participantMemories,
        });
      } catch (error) {
        console.warn(`Social decision failed safely to silence: ${String(error)}`);
        decision = { action: "silence" };
      }
      const scheduleMemory = (): void => {
        scheduleRememberedMessage(pending, options.longTermMemory, userId, input.threadId, input.message.text);
      };
      if (decision.action === "silence") {
        scheduleMemory();
        return GeneratedTurn.fromSilence();
      }
      const resolved = resolveDecision(decision, candidates);
      if (resolved === undefined) {
        scheduleMemory();
        return GeneratedTurn.fromSilence();
      }
      const response = await model.invoke([
        new SystemMessage(personality),
        new HumanMessage(realizationContext(
          history, memoriesForTarget(participantMemories, resolved.target), resolved,
        )),
      ]);
      if (!isBaseMessage(response)) throw new InvalidRealizationResponseError();
      const replyText = extractText(response.content).trim();
      if (!replyText) throw new InvalidRealizationResponseError();
      return GeneratedTurn.fromReply(replyText, replyRelationship(resolved.target), (messageId) => {
        const delivered = deliveredEvent(
          messageId, input.hevroniaSender, replyText, input.message, resolved.target,
        );
        canonicalWrites.enqueue(input.threadId, () => store.append(input.threadId, delivered));
        scheduleMemory();
      });
    },
    recordDeliveredMessage: (threadId, message) => {
      canonicalWrites.enqueue(threadId, () => store.append(threadId, message));
    },
    getMessages: async (threadId) => { await canonicalWrites.waitForThread(threadId);
      return store.getMessages(threadId); },
    async close(): Promise<void> {
      await canonicalWrites.drain(); await pending.drain();
      checkpointer.db.close();
    },
  };
}
