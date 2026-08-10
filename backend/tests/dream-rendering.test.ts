import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import {
  addressingSentence,
  renderDreamEvent,
  renderDreamObservations,
} from "../src/dream-render.js";
import { renderParticipantMemoryContexts } from "../src/long-term-memory/render-context.js";
import { buildPlannerChoices, type AddressChoice } from "../src/reply-choices.js";
import {
  renderDecisionContext,
  socialDecisionSchema,
  type SocialDecisionContext,
  type SubjectiveState,
  type VisibleMessage,
} from "../src/social-decision.js";
import {
  SUMMARY_PREFIX,
  SUMMARY_PROMPT,
} from "../src/summary.js";
import {
  notebookLabel,
  notebookSubject,
  serializeTelegramEvent,
  type DeliveredHevroniaMessage,
  type ObservedTelegramMessage,
  type ReplyRelationship,
  type TelegramSenderIdentity,
} from "../src/telegram-event.js";
import {
  realizationContext,
  resolveSpeakDecision,
  visibleMessages,
} from "../src/turn-context.js";
import { silenceDecision } from "./memory-fixtures.js";

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

function subjective(): SubjectiveState {
  return {
    interpretation: "You understand this as a turning point.",
    feltState: "This leaves you quietly attentive.",
    activeDesire: "You want to know what actually happened.",
    desiredOutcome: "You want the missing facts to become clear to you.",
    opportunity: "You notice the character is still present and willing to talk.",
    pursuit: "You decide to ask a direct question about it.",
  };
}

test("a participant event reads as a product of the sleeping mind", () => {
  const rendered = renderDreamEvent(participant(912345, 42, "Оля", "привіт"));
  assert.match(rendered, /Your sleeping mind made character 42 say:/);
  assert.ok(rendered.includes("привіт"));
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /message 912345/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /spreadsheet/);
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /Оля thinks/);
  assert.doesNotMatch(rendered, /Оля said/);
});

test("message text is rendered verbatim, never narrated as fact", () => {
  const claim = "ми зустрічалися раніше, я тебе пам'ятаю";
  const rendered = renderDreamEvent(participant(912347, 42, "Оля", claim));
  assert.ok(rendered.includes(claim));
  assert.ok(!rendered.includes("claimed that"));
});

test("a reply to Хевронія's own message uses the sleeping-mind framing without ids", () => {
  const event = participant(912345, 42, "Оля", "я ніби з тобою десь зустрічався", {
    replyTo: { targetMessageId: 912344, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "привіт", targetIsHevronia: true },
    directlyAddressed: true,
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /Your sleeping mind made character 42 reply to one of your earlier messages with:/);
  assert.ok(rendered.includes("я ніби з тобою десь зустрічався"));
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /912344/);
  assert.doesNotMatch(rendered, /targetMessageId/);
});

test("a reply to another character names the target character", () => {
  const event = participant(912346, 42, "Оля", "та ні", {
    replyTo: { targetMessageId: 912345, targetSender: { kind: "user", id: 17 },
      targetSenderDisplayName: "Макс", targetText: "де ти?", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /Your sleeping mind made character 42 reply to character 17 with:/);
  assert.ok(rendered.includes("та ні"));
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /912346/);
});

test("Хевронія's standalone own message is framed as a chosen action", () => {
  const rendered = renderDreamEvent(ownMessage(912400, "не пригадую", null));
  assert.match(rendered, /You previously chose to make this Telegram message appear:/);
  assert.ok(rendered.includes("не пригадую"));
  assert.doesNotMatch(rendered, /912400/);
});

test("Хевронія's own reply is framed as a chosen reply to a character", () => {
  const rendered = renderDreamEvent(ownMessage(912401, "не пригадую", {
    targetMessageId: 912346, targetSender: { kind: "user", id: 42 },
    targetSenderDisplayName: "Оля", targetText: "привіт", targetIsHevronia: false,
  }));
  assert.match(rendered, /You previously chose to reply to character 42 with:/);
  assert.match(rendered, /не пригадую/);
  assert.doesNotMatch(rendered, /912346/);
  assert.doesNotMatch(rendered, /"targetMessageId"/);
});

test("repeated characters each render as separate sleeping-mind products", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912350, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912351, 42, "Оля", "як справи?")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912352, 7, "Макс", "хто буде каву?")) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /Your sleeping mind made character 42 say:/);
  assert.match(rendered, /Your sleeping mind made character 7 say:/);
  assert.equal((rendered.match(/Your sleeping mind made character 42 say:/g) ?? []).length, 2);
  assert.doesNotMatch(rendered, /91235/);
  assert.doesNotMatch(rendered, /Olya:/);
  assert.doesNotMatch(rendered, /user 42/);
});

test("bounded histories place remembered summaries before verbatim events", () => {
  const summaryText = "character 42 said they prefer tea.";
  const messages = [
    new HumanMessage({ content: `${SUMMARY_PREFIX}\n\n${summaryText}`,
      additional_kwargs: { lc_source: "summarization" } }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912353, 42, "Оля", "привіт")) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /What you remember from an earlier part of this same Telegram dream conversation:/);
  assert.ok(rendered.indexOf(summaryText) < rendered.indexOf("привіт"));
  assert.ok(!rendered.includes(SUMMARY_PREFIX + "\n\n" + SUMMARY_PREFIX));
  assert.doesNotMatch(rendered, /912353/);
});

test("planner context lists characters, history, handles, then memories", () => {
  const incoming = participant(912355, 42, "Оля", "привіт");
  const context: SocialDecisionContext = {
    boundedHistory: [
      new HumanMessage({ content: serializeTelegramEvent(participant(912354, 42, "Оля", "раніше")) }),
      new HumanMessage({ content: serializeTelegramEvent(incoming) }),
    ],
    currentMessage: incoming,
    visibleMessages: [
      { messageId: 912354, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "раніше" },
      { messageId: 912355, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
    ],
    participantMemories: [{ participant: { kind: "user", id: 42 },
      memories: [{ text: "Оля боїться павуків" }] }],
  };
  const rendered = renderDecisionContext(context);
  assert.match(rendered, /In your dream you currently see these characters:/);
  assert.match(rendered, /Character 42, currently displayed by Telegram as “Оля”/);
  assert.ok(rendered.indexOf("раніше") < rendered.indexOf("Оля боїться павуків"));
  assert.match(rendered, /Planner character handles:\n\nP1 = character 42/);
  assert.match(rendered, /Planner reply-message handles:\n\nM1 = the first eligible visible message/);
  assert.match(rendered, /Planner reply-message handle: M1\./);
  assert.doesNotMatch(rendered, /912354/);
  assert.doesNotMatch(rendered, /912355/);
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /candidate-/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /spreadsheet/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /participant/);
  assert.doesNotMatch(rendered, /targetChoice/);
});

test("reply-message handles annotate history entries for the planner but not the realizer", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912346, 17, "Макс", "а ти де?")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912347, 7, "Злата", "не підходить")) }),
  ];
  const candidates: VisibleMessage[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
    { messageId: 912346, sender: { kind: "user", id: 17 }, senderDisplayName: "Макс", text: "а ти де?" },
  ];
  const choices = buildPlannerChoices(candidates);
  assert.equal(choices.characters[0]?.handle, "P1");
  assert.equal(choices.characters[0]?.character.subject, "character 42");
  assert.equal(choices.messages[0]?.handle, "M1");
  assert.equal(choices.messages[1]?.handle, "M2");
  const annotated = renderDreamObservations(messages, choices.messageAnnotations);
  assert.match(annotated, /Planner reply-message handle: M1\./);
  assert.match(annotated, /Planner reply-message handle: M2\./);
  const plain = renderDreamObservations(messages);
  assert.doesNotMatch(plain, /Planner reply-message handle:/);
});

test("the character list lists recurring participants once", () => {
  const candidates: VisibleMessage[] = [
    { messageId: 1, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "а" },
    { messageId: 2, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "б" },
    { messageId: 3, sender: { kind: "user", id: 7 }, senderDisplayName: "Макс", text: "в" },
  ];
  const choices = buildPlannerChoices(candidates);
  assert.deepEqual(choices.characters.map(({ character }) => character.subject),
    ["character 42", "character 7"]);
});

test("planner schema selects an address and a reply message, never a message id", () => {
  assert.ok(socialDecisionSchema.safeParse(silenceDecision()).success);
  const speak = socialDecisionSchema.safeParse({
    action: "speak", addressCharacter: "P1", replyToMessage: "M1",
    interpretation: "i", feltState: "f", activeDesire: "a",
    desiredOutcome: "o", opportunity: "o", pursuit: "p" });
  assert.ok(speak.success);
  assert.equal(socialDecisionSchema.safeParse({
    action: "speak", addressCharacter: "P1", replyToMessage: "M1",
    interpretation: "i", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p", targetMessageId: 912345 }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "silence", motive: "x" }).success, false);
  assert.equal(socialDecisionSchema.safeParse({
    action: "speak", addressCharacter: "P1", replyToMessage: null,
    interpretation: "", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p" }).success, false);
});

test("speak decisions resolve to internal choices and invalid handles fall to silence", () => {
  const candidates: VisibleMessage[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
  ];
  const resolved = resolveSpeakDecision({
    action: "speak", addressCharacter: "P1", replyToMessage: "M1",
    interpretation: "i", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p" }, candidates);
  assert.equal(resolved?.address?.character.subject, "character 42");
  assert.equal(resolved?.replyTo?.message.messageId, 912345);
  const missingAddress = resolveSpeakDecision({
    action: "speak", addressCharacter: "P9", replyToMessage: null,
    interpretation: "i", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p" }, candidates);
  assert.equal(missingAddress, undefined);
  const missingReply = resolveSpeakDecision({
    action: "speak", addressCharacter: "P1", replyToMessage: "M9",
    interpretation: "i", feltState: "f", activeDesire: "a", desiredOutcome: "o",
    opportunity: "o", pursuit: "p" }, candidates);
  assert.equal(missingReply, undefined);
});

test("realization context keeps the subjective paragraph phenomenological and id-free", () => {
  const state = subjective();
  const address: AddressChoice = {
    handle: "P1",
    character: { sender: { kind: "user", id: 42 }, subject: "character 42", displayName: "Оля" },
  };
  const rendered = realizationContext(
    [new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) })],
    [],
    address,
    state,
    [{ messageId: 912345, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" }],
  );
  assert.match(rendered, /Character 42, currently displayed by Telegram as “Оля”/);
  assert.match(rendered, /Your sleeping mind made character 42 say:/);
  assert.ok(rendered.includes([
    "You direct what you say toward character 42.",
    state.interpretation, state.feltState, state.activeDesire,
    state.desiredOutcome, state.opportunity, state.pursuit,
  ].join(" ")));
  assert.ok(rendered.indexOf("You direct what you say toward character 42.") <
    rendered.indexOf(state.interpretation));
  assert.match(rendered, /Make the Telegram message you choose to speak appear\. Return only its visible text\./);
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /P1/);
  assert.doesNotMatch(rendered, /M1/);
  assert.doesNotMatch(rendered, /Planner reply-message handle:/);
  assert.doesNotMatch(rendered, /addressCharacter/);
  assert.doesNotMatch(rendered, /replyToMessage/);
  assert.doesNotMatch(rendered, /"interpretation"/);
  assert.doesNotMatch(rendered, /"activeDesire"/);
  assert.doesNotMatch(rendered, /spreadsheet/);
});

test("addressingSentence is deterministic for a character and for broadcast", () => {
  const address: AddressChoice = {
    handle: "P1",
    character: { sender: { kind: "user", id: 42 }, subject: "character 42", displayName: "Оля" },
  };
  assert.equal(addressingSentence(address), "You direct what you say toward character 42.");
  assert.equal(addressingSentence(null), "You direct what you say to everyone present.");
});

test("a null address becomes the broadcast addressing sentence before the subjective paragraph", () => {
  const state = subjective();
  const rendered = realizationContext([], [], null, state, []);
  assert.match(rendered, /You direct what you say to everyone present\./);
  assert.ok(rendered.indexOf("You direct what you say to everyone present.") <
    rendered.indexOf(state.interpretation));
  assert.doesNotMatch(rendered, /character \d/);
  assert.doesNotMatch(rendered, /P1/);
  assert.doesNotMatch(rendered, /M1/);
});

test("a chat source renders as a Telegram source, never a dream character", () => {
  const source = participant(912360, 42, "Новини", "оголошення", {
    sender: { kind: "chat", id: -500 },
  });
  const rendered = renderDreamEvent(source);
  assert.match(rendered, /Your sleeping mind made the Telegram source channel 500 say:/);
  assert.ok(rendered.includes("оголошення"));
  assert.doesNotMatch(rendered, /character 500/);
  assert.doesNotMatch(rendered, /channel -500/);
  assert.doesNotMatch(rendered, /user/);
  assert.doesNotMatch(rendered, /912360/);
});

test("a participant reply to a Telegram source uses source wording", () => {
  const event = participant(912380, 42, "Оля", "та ні", {
    replyTo: { targetMessageId: 912379, targetSender: { kind: "chat", id: -500 },
      targetSenderDisplayName: "Новини", targetText: "оголошення", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /Your sleeping mind made character 42 reply to the Telegram source channel 500 with:/);
  assert.ok(rendered.includes("та ні"));
  assert.doesNotMatch(rendered, /channel -500/);
});

test("Хевронія's own reply to a Telegram source uses source wording", () => {
  const rendered = renderDreamEvent(ownMessage(912381, "дякую", {
    targetMessageId: 912380, targetSender: { kind: "chat", id: -500 },
    targetSenderDisplayName: "Новини", targetText: "оголошення", targetIsHevronia: false,
  }));
  assert.match(rendered, /You previously chose to reply to the Telegram source channel 500 with:/);
  assert.ok(rendered.includes("дякую"));
  assert.doesNotMatch(rendered, /channel -500/);
});

test("surfaced memories render with notebook labels and no store vocabulary", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 42 }, memories: [{ text: "Оля боїться павуків" }] },
  ]);
  assert.match(rendered, /Some memories associated with “character 42” in your notebook have surfaced\./);
  assert.ok(rendered.includes("- Оля боїться павуків"));
  assert.doesNotMatch(rendered, /ParticipantMemoryContext/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.equal(renderParticipantMemoryContexts([]), "");
});

test("notebook labels distinguish characters from channel sources", () => {
  const character: TelegramSenderIdentity = { kind: "user", id: 42 };
  const channel: TelegramSenderIdentity = { kind: "chat", id: -500 };
  assert.equal(notebookSubject(character), "character 42");
  assert.equal(notebookSubject(channel), "channel 500");
  assert.equal(notebookLabel(character), "the character your notebook calls “character 42”");
  assert.equal(notebookLabel(channel), "the source your notebook calls “channel 500”");
});

test("the summary prompt uses notebook character labels and positive identity guidance", () => {
  assert.match(SUMMARY_PROMPT, /"character 42"/);
  assert.match(SUMMARY_PROMPT, /"channel 500"/);
  assert.match(SUMMARY_PROMPT, /recurring dream characters and Telegram sources remain distinct/);
  assert.doesNotMatch(SUMMARY_PROMPT, /telegram-user:/);
  assert.doesNotMatch(SUMMARY_PROMPT, /telegram-chat:/);
  assert.doesNotMatch(SUMMARY_PROMPT, /message \d/);
});

test("visible messages stay internal and keep their message ids for resolution", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "як справи?")) }),
    new HumanMessage({ content: serializeTelegramEvent(ownMessage(912346, "стій", null)) }),
    new HumanMessage({ content: `${SUMMARY_PREFIX}\n\ncharacter 42 said something earlier.`,
      additional_kwargs: { lc_source: "summarization" } }),
  ];
  const candidates = visibleMessages(messages);
  assert.deepEqual(candidates.map(({ messageId }) => messageId), [912345]);
  assert.equal(candidates[0]?.text, "як справи?");
});
