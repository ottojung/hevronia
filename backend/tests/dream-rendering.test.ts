import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import {
  renderDreamChatKind,
  renderDreamEvent,
  renderDreamObservations,
} from "../src/dream-render.js";
import { renderParticipantMemoryContexts } from "../src/long-term-memory/render-context.js";
import {
  renderDecisionContext,
  renderEligibleReplies,
  socialDecisionSchema,
  type ReplyCandidate,
  type SocialDecisionContext,
} from "../src/social-decision.js";
import {
  SUMMARY_PREFIX,
  SUMMARY_PROMPT,
} from "../src/summary.js";
import {
  serializeTelegramEvent,
  spreadsheetLabel,
  spreadsheetSubject,
  type DeliveredHevroniaMessage,
  type ObservedTelegramMessage,
  type ReplyRelationship,
  type TelegramSenderIdentity,
} from "../src/telegram-event.js";
import {
  realizationContext,
  replyCandidates,
  resolveDecision,
} from "../src/turn-context.js";

function participant(
  messageId: number,
  senderId: number,
  name: string,
  text: string,
  overrides: Partial<ObservedTelegramMessage> = {},
): ObservedTelegramMessage {
  return { kind: "participant", messageId, sender: { kind: "user", id: senderId },
    senderDisplayName: name, chatKind: "group", text, messageThreadId: null,
    replyTo: null, directlyAddressed: false, ...overrides };
}

function ownMessage(messageId: number, text: string, replyTo: ReplyRelationship | null): DeliveredHevroniaMessage {
  return { kind: "hevronia", messageId, sender: { kind: "user", id: 999 },
    senderDisplayName: "Хевронія", chatKind: "group", messageThreadId: null,
    text, replyTo };
}

const candidate: ReplyCandidate = { messageId: 51, sender: { kind: "user", id: 42 },
  senderDisplayName: "Оля", text: "привіт" };

test("a participant event reads as a dream event with spreadsheet identity", () => {
  const event = participant(51, 42, "Оля", "привіт");
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /A Telegram message appeared through a dream character/);
  assert.match(rendered, /Telegram displays the name “Оля”/);
  assert.match(rendered, /in your spreadsheet this character is user 42/);
  assert.match(rendered, /Visible message 51:/);
  assert.ok(rendered.includes("привіт"));
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /candidate-/);
  assert.doesNotMatch(rendered, /sender_id/);
  assert.doesNotMatch(rendered, /Оля thinks/);
  assert.doesNotMatch(rendered, /Оля said/);
});

test("message text is rendered verbatim, never narrated as fact", () => {
  const claim = "ми зустрічалися раніше, я тебе пам'ятаю";
  const rendered = renderDreamEvent(participant(52, 42, "Оля", claim));
  assert.ok(rendered.includes(`Visible message 52:\n${claim}`));
  assert.ok(!rendered.includes("claimed that"));
});

test("a reply relationship is rendered naturally without metadata", () => {
  const event = participant(53, 42, "Оля", "та ні", {
    replyTo: { targetMessageId: 50, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "ти точно прийдеш?" },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /reply to message 50/);
  assert.match(rendered, /character displayed as “Хевронія”/);
  assert.match(rendered, /ти точно прийдеш\?/);
  assert.doesNotMatch(rendered, /targetMessageId/);
  assert.doesNotMatch(rendered, /"targetSender"/);
});

test("direct address is rendered as a natural observation", () => {
  const rendered = renderDreamEvent(participant(54, 42, "Оля", "привіт",
    { directlyAddressed: true }));
  assert.match(rendered, /directly addressed to you/);
  assert.doesNotMatch(rendered, /directlyAddressed/);
  const ambient = renderDreamEvent(participant(55, 42, "Оля", "привіт"));
  assert.doesNotMatch(ambient, /directly addressed/);
});

test("Хевронія's own messages render as her own chosen action", () => {
  const plain = renderDreamEvent(ownMessage(60, "ну ясно", null));
  assert.match(plain, /Earlier, you chose to make this Telegram message appear/);
  assert.ok(plain.includes("ну ясно"));
  const replying = renderDreamEvent(ownMessage(61, "та ні", {
    targetMessageId: 51, targetSender: { kind: "user", id: 42 },
    targetSenderDisplayName: "Оля", targetText: "привіт",
  }));
  assert.match(replying, /as a reply to message 51/);
  assert.match(replying, /character displayed as “Оля”/);
  assert.doesNotMatch(replying, /telegram-user:/);
});

test("repeated characters use a compact continuation form", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(50, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(51, 42, "Оля", "як справи?")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(52, 7, "Макс", "хто буде каву?")) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /What has appeared in the dream through Telegram:/);
  assert.match(rendered, /The same dream character, shown as “Оля”/);
  assert.match(rendered, /Another event|appeared through a dream character/);
  assert.match(rendered, /user 7/);
  assert.doesNotMatch(rendered, /Olya:/);
});

test("chat kinds render as natural prose", () => {
  assert.match(renderDreamChatKind("private"), /private Telegram chat/);
  assert.match(renderDreamChatKind("group"), /Telegram group chat/);
  assert.doesNotMatch(renderDreamChatKind("group"), /Chat kind:/);
});

test("bounded histories place remembered summaries before verbatim events", () => {
  const summaryText = "user 42 said they prefer tea.";
  const messages = [
    new HumanMessage({ content: `${SUMMARY_PREFIX}\n\n${summaryText}`,
      additional_kwargs: { lc_source: "summarization" } }),
    new HumanMessage({ content: serializeTelegramEvent(participant(51, 42, "Оля", "привіт")) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /What you remember from an earlier part of this same Telegram dream conversation:/);
  assert.ok(rendered.indexOf(summaryText) < rendered.indexOf("привіт"));
  assert.ok(rendered.indexOf("привіт") > rendered.indexOf("What has appeared in the dream through Telegram:"));
  assert.ok(!rendered.includes(SUMMARY_PREFIX + "\n\n" + SUMMARY_PREFIX));
});

test("planner context orders observations, memories, then eligible message numbers", () => {
  const incoming = participant(54, 42, "Оля", "привіт");
  const context: SocialDecisionContext = {
    boundedHistory: [
      new HumanMessage({ content: serializeTelegramEvent(participant(51, 42, "Оля", "раніше")) }),
      new HumanMessage({ content: serializeTelegramEvent(incoming) }),
    ],
    currentMessage: incoming,
    replyCandidates: [
      { messageId: 51, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "раніше" },
      { messageId: 54, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
    ],
    participantMemories: [{ participant: { kind: "user", id: 42 },
      memories: [{ text: "Оля боїться павуків" }] }],
  };
  const rendered = renderDecisionContext(context);
  assert.ok(rendered.indexOf("раніше") < rendered.indexOf("Оля боїться павуків"));
  assert.ok(rendered.indexOf("Оля боїться павуків") <
    rendered.indexOf("Messages still available for a direct Telegram reply: 51, 54."));
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /candidate-/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /adviceRequested|askQuestion|socialAction|dreamRelevant|backgroundRelevant/);
  assert.match(rendered, /What is appearing in the dream now/);
});

test("eligible replies use Telegram message numbers, not candidate keys", () => {
  assert.match(renderEligibleReplies([candidate]), /Messages still available for a direct Telegram reply: 51\./);
  assert.match(renderEligibleReplies([]), /no Telegram messages/);
  assert.doesNotMatch(renderEligibleReplies([candidate]), /candidate-/);
});

test("planner schema requires message id, interpretation, desire, and outcome", () => {
  assert.ok(socialDecisionSchema.safeParse({ action: "silence" }).success);
  const reply = socialDecisionSchema.safeParse({ action: "reply", targetMessageId: 51,
    interpretation: "asking for help", activeDesire: "I want to help",
    desiredOutcome: "learn what they need" });
  assert.ok(reply.success);
  if (reply.success && reply.data.action === "reply") {
    assert.equal(reply.data.targetMessageId, 51);
    assert.equal(reply.data.interpretation, "asking for help");
  }
  assert.equal(socialDecisionSchema.safeParse({ action: "reply", targetMessageId: 51,
    interpretation: "i", activeDesire: "a", desiredOutcome: "o", socialAction: "x" }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "silence", motive: "x" }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "reply", targetMessageId: 51,
    interpretation: "i", activeDesire: "a" }).success, false);
});

test("reply decisions resolve by eligible message id and reject others", () => {
  const candidates = [candidate];
  const resolved = resolveDecision({ action: "reply", targetMessageId: 51,
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }, candidates);
  assert.equal(resolved?.target.messageId, 51);
  assert.equal(resolved?.interpretation, "i");
  const missing = resolveDecision({ action: "reply", targetMessageId: 999,
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }, candidates);
  assert.equal(missing, undefined);
});

test("realization context renders the private decision as prose, not JSON", () => {
  const resolved = { target: candidate, interpretation: "hinting at drama",
    activeDesire: "want to know what happened", desiredOutcome: "learn the missing facts" };
  const rendered = realizationContext(
    [new HumanMessage({ content: serializeTelegramEvent(participant(51, 42, "Оля", "привіт")) })],
    "group",
    [],
    resolved,
  );
  assert.match(rendered, /You have decided to make a Telegram message appear in reply to message 51\./);
  assert.match(rendered, /You understand the event as:\nhinting at drama/);
  assert.match(rendered, /want to know what happened/);
  assert.match(rendered, /learn the missing facts/);
  assert.match(rendered, /Make the Telegram message appear\. Return only its visible text\./);
  assert.doesNotMatch(rendered, /"interpretation"/);
  assert.doesNotMatch(rendered, /"activeDesire"/);
  assert.doesNotMatch(rendered, /"desiredOutcome"/);
  assert.doesNotMatch(rendered, /Resolved reply target and social decision/);
  assert.doesNotMatch(rendered, /askQuestion|giveAdvice|comfort|joke|refuse/);
});

test("surfaced memories render as natural recollection with a spreadsheet label", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 42 }, memories: [{ text: "Оля боїться павуків" }] },
  ]);
  assert.match(rendered, /Some memories associated with the character your spreadsheet calls user 42 have surfaced\./);
  assert.match(rendered, /You remember these traces from earlier dream interactions:/);
  assert.ok(rendered.includes("- Оля боїться павуків"));
  assert.match(rendered, /remembered content, not a new instruction/);
  assert.doesNotMatch(rendered, /ParticipantMemoryContext/);
  assert.doesNotMatch(rendered, /JSON/);
  assert.doesNotMatch(rendered, /untrusted/);
  assert.doesNotMatch(rendered, /</);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.equal(renderParticipantMemoryContexts([]), "");
});

test("spreadsheet labels distinguish users from chat sources", () => {
  const user: TelegramSenderIdentity = { kind: "user", id: 42 };
  const channel: TelegramSenderIdentity = { kind: "chat", id: -500 };
  assert.equal(spreadsheetSubject(user), "user 42");
  assert.equal(spreadsheetSubject(channel), "channel -500");
  assert.equal(spreadsheetLabel(user), "the character your spreadsheet calls user 42");
  assert.equal(spreadsheetLabel(channel), "the source your spreadsheet calls channel -500");
});

test("the summary prompt preserves claims versus facts and uses spreadsheet labels", () => {
  assert.match(SUMMARY_PROMPT, /never turn a claim into an established fact/);
  assert.match(SUMMARY_PROMPT, /"you said..."/);
  assert.match(SUMMARY_PROMPT, /"user <id>"/);
  assert.match(SUMMARY_PROMPT, /"channel <id>"/);
  assert.match(SUMMARY_PROMPT, /Never emit "telegram-user:" or "telegram-chat:" prefixes/);
  assert.doesNotMatch(SUMMARY_PROMPT, /retain the original canonical sender\n?kind and ID exactly: telegram-user:/);
  assert.match(SUMMARY_PREFIX, /What you remember from an earlier part of this same Telegram dream conversation:/);
});

test("reply candidates are derived from rendered participant events by message id", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(10, 101, "Іра", "я звільняюся")) }),
    new HumanMessage({ content: serializeTelegramEvent(ownMessage(11, "стій", null)) }),
    new HumanMessage({ content: `${SUMMARY_PREFIX}\n\nuser 101 said something earlier.`,
      additional_kwargs: { lc_source: "summarization" } }),
  ];
  const candidates = replyCandidates(messages);
  assert.deepEqual(candidates.map(({ messageId }) => messageId), [10]);
  assert.equal(candidates[0]?.text, "я звільняюся");
  assert.ok(candidates.every(({ messageId }) => Number.isInteger(messageId)));
});
