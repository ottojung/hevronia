import { conversationThreadIdFromTelegramPrivateChat } from "../../src/identifiers.js";
import type { ObservedTelegramMessage, TelegramSenderIdentity } from "../../src/telegram-event.js";
import type { ConversationScenario, ScenarioDependencies, ScenarioResult, TranscriptEntry } from "./types.js";

const PARTICIPANT_ID = 7_001;
const HEVRONIA_ID = 7_002;
const CHAT_ID = 7_003;

export async function runScenario(
  scenario: ConversationScenario,
  rounds: number,
  dependencies: ScenarioDependencies,
): Promise<ScenarioResult> {
  const layer = await dependencies.createLayer();
  const transcript: TranscriptEntry[] = [];
  const threadId = conversationThreadIdFromTelegramPrivateChat(CHAT_ID);
  const participantSender: TelegramSenderIdentity = { kind: "user", id: PARTICIPANT_ID };
  const hevroniaSender: TelegramSenderIdentity = { kind: "user", id: HEVRONIA_ID };
  let messageId = 0;
  let consecutiveSilences = 0;
  let roundsCompleted = 0;
  let stoppingReason: ScenarioResult["stoppingReason"] = "round limit reached";
  try {
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
      const turn = await layer.respond({ threadId, message, hevroniaSender });
      roundsCompleted += 1;
      if (turn.outcome.action === "silence") {
        consecutiveSilences += 1;
        transcript.push({ speaker: "hevronia", silence: true });
        dependencies.print("Хевронія: [silence]");
        if (consecutiveSilences === 2) {
          stoppingReason = "stopped after two consecutive silences";
          break;
        }
      } else {
        consecutiveSilences = 0;
        messageId += 1;
        turn.outcome.persistDelivery(messageId);
        transcript.push({ speaker: "hevronia", text: turn.outcome.replyText });
        dependencies.print(`Хевронія: ${turn.outcome.replyText}`);
      }
      dependencies.print("");
    }
    return { scenario, transcript, roundsCompleted, stoppingReason };
  } finally {
    await layer.close();
  }
}
