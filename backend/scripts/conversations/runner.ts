import { conversationThreadIdFromTelegramPrivateChat } from "../../src/identifiers.js";
import type { ConversationLayer } from "../../src/conversation-types.js";
import type { ObservedTelegramMessage, TelegramSenderIdentity } from "../../src/telegram-event.js";
import type { ConversationScenario, ScenarioDependencies, ScenarioResult, ScenarioStoppingReason, TranscriptEntry } from "./types.js";
import { completedScenarioResult, failedScenarioResult } from "./types.js";
import { PARTICIPANT_ID, HEVRONIA_ID, CHAT_ID } from "./identities.js";

export function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/\s+/gu, " ").trim();
}

export async function runScenario(
  scenario: ConversationScenario,
  rounds: number,
  dependencies: ScenarioDependencies,
): Promise<ScenarioResult> {
  const transcript: TranscriptEntry[] = [];
  const threadId = conversationThreadIdFromTelegramPrivateChat(CHAT_ID);
  const participantSender: TelegramSenderIdentity = { kind: "user", id: PARTICIPANT_ID };
  const hevroniaSender: TelegramSenderIdentity = { kind: "user", id: HEVRONIA_ID };
  let messageId = 0;
  let consecutiveSilences = 0;
  let roundsCompleted = 0;
  let stoppingReason: ScenarioStoppingReason = "round limit reached";
  let layer: ConversationLayer | undefined;
  let layerClosed = false;
  const closeLayer = async (): Promise<void> => {
    if (layer === undefined || layerClosed) return;
    layerClosed = true;
    await layer.close();
  };
  try {
    layer = await dependencies.createLayer();
    for (let round = 0; round < rounds; round += 1) {
      const participantText = await dependencies.simulator.nextMessage(scenario, transcript);
      transcript.push({ speaker: "participant", text: participantText });
      dependencies.print(`${scenario.participantName}: ${participantText}`);
      messageId += 1;
      const message: ObservedTelegramMessage = {
        kind: "participant", messageId, sender: participantSender,
        senderDisplayName: scenario.participantName, chatKind: "private", text: participantText,
        messageThreadId: null, replyTo: null, directlyAddressed: true,
      };
      const turn = await layer.respond({ threadId, message, hevroniaSender,
        senderIsBot: false });
      roundsCompleted += 1;
      dependencies.onRound?.(roundsCompleted);
      if (turn.outcome.action === "silence") {
        consecutiveSilences += 1;
        transcript.push({ speaker: "hevronia", silence: true });
        dependencies.print("Хевронія: [silence]");
        const maxSilences = 10;
        if (consecutiveSilences === maxSilences) {
          stoppingReason = "stopped after several consecutive silences";
          break;
        }
      } else if (turn.outcome.action === "ended") {
        stoppingReason = "generator produced no message";
        transcript.push({ speaker: "hevronia", ended: true });
        dependencies.print("Хевронія: [conversation ended]");
        break;
      } else {
        consecutiveSilences = 0;
        messageId += 1;
        turn.outcome.persistDelivery(messageId);
        transcript.push({ speaker: "hevronia", text: turn.outcome.replyText });
        dependencies.print(`Хевронія: ${turn.outcome.replyText}`);
      }
      dependencies.print("");
    }
    await closeLayer();
    return completedScenarioResult(scenario, transcript, roundsCompleted, stoppingReason);
  } catch (error) {
    let failure = errorDetail(error);
    try {
      await closeLayer();
    } catch (closeError) {
      failure = `${failure}; additionally failed to close the conversation layer: ${errorDetail(closeError)}`;
    }
    return failedScenarioResult(scenario, transcript, roundsCompleted, failure);
  }
}
