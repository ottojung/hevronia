import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import {
  renderConversationFraming,
  renderDreamEvent,
  renderDreamObservations,
} from "../src/dream-render.js";
import { escapeMessageText } from "../src/dream-render-replies.js";
import { renderPlannerContext } from "../src/attention-planner.js";
import { renderParticipantMemoryContexts } from "../src/long-term-memory/render-context.js";
import { buildHandleChoices } from "../src/handles.js";
import {
  buildRealizerResponseSchema,
  type TurnContext,
  type VisibleMessage,
} from "../src/realizer-response-schema.js";
import { realizerDecisionSchema } from "../src/realizer-schema.js";
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
  resolveRealizerDecision,
  renderRealizerContext,
  visibleMessages,
} from "../src/turn-context.js";
import { realizerSilence, realizerSpeak } from "./memory-fixtures.js";

function participant(
  messageId: number,
  senderId: number,
  name: string,
  text: string,
  overrides: Partial<ObservedTelegramMessage> = {},
): ObservedTelegramMessage {
  return { kind: "participant", messageId, sender: { kind: "user", id: senderId },
    senderDisplayName: name, senderUsername: null, chatKind: "group", text,
    messageThreadId: null, replyTo: null, directlyAddressed: false, ...overrides };
}

function ownMessage(messageId: number, text: string, replyTo: ReplyRelationship | null): DeliveredHevroniaMessage {
  return { kind: "hevronia", messageId, sender: { kind: "user", id: 999 },
    senderDisplayName: "Хевронія", senderUsername: null, chatKind: "group",
    messageThreadId: null, text, replyTo };
}

function context(history: HumanMessage[], visible: VisibleMessage[]): TurnContext {
  return {
    boundedHistory: history,
    currentMessage: participant(912355, 42, "Оля", "привіт"),
    visibleMessages: visible,
    participantMemories: [{ participant: { kind: "user", id: 42 },
      memories: [{ text: "Оля боїться павуків" }] }],
    naturalNames: new Map(),
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
      targetSenderDisplayName: "Хевронія", targetSenderUsername: null, targetText: "привіт", targetIsHevronia: true },
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
      targetSenderDisplayName: "Макс", targetSenderUsername: null, targetText: "де ти?", targetIsHevronia: false },
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
    targetSenderDisplayName: "Оля", targetSenderUsername: null, targetText: "привіт", targetIsHevronia: false,
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

test("planner context lists characters, history, and memories but never handles or ids", () => {
  const incoming = participant(912355, 42, "Оля", "привіт");
  const history = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912354, 42, "Оля", "раніше")) }),
    new HumanMessage({ content: serializeTelegramEvent(incoming) }),
  ];
  const rendered = renderPlannerContext(context(history, [
    { messageId: 912354, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "раніше" },
    { messageId: 912355, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "привіт" },
  ]), []);
  assert.match(rendered, /In your dream you currently see these characters:/);
  assert.match(rendered, /Character 42 in your notebook has not acquired a natural name yet\.\nTelegram currently displays them as “Оля”\./);
  assert.ok(rendered.indexOf("раніше") < rendered.indexOf("Оля боїться павуків"));
  assert.match(rendered, /This is a group chat, where most messages are not addressed to you/);
  assert.doesNotMatch(rendered, /Character handles/);
  assert.doesNotMatch(rendered, /Reply-message handles/);
  assert.doesNotMatch(rendered, /P1/);
  assert.doesNotMatch(rendered, /M1/);
  assert.doesNotMatch(rendered, /Reply-message handle:/);
  assert.doesNotMatch(rendered, /912354/);
  assert.doesNotMatch(rendered, /912355/);
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /spreadsheet/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /participant/);
});

test("reply-message handles annotate history entries for the realizer only", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912346, 17, "Макс", "а ти де?")) }),
  ];
  const candidates: VisibleMessage[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "привіт" },
    { messageId: 912346, sender: { kind: "user", id: 17 },   senderDisplayName: "Макс", senderUsername: null, text: "а ти де?" },
  ];
  const choices = buildHandleChoices(candidates);
  assert.equal(choices.characters[0]?.handle, "P1");
  assert.equal(choices.characters[0]?.character.subject, "character 42");
  assert.equal(choices.messages[0]?.handle, "M1");
  assert.equal(choices.messages[1]?.handle, "M2");
  const annotated = renderDreamObservations(messages, choices.messageAnnotations);
  assert.match(annotated, /Reply-message handle: M1\./);
  assert.match(annotated, /Reply-message handle: M2\./);
  const plain = renderDreamObservations(messages);
  assert.doesNotMatch(plain, /Reply-message handle:/);
});

test("the character list lists recurring participants once", () => {
  const candidates: VisibleMessage[] = [
    { messageId: 1, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "а" },
    { messageId: 2, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "б" },
    { messageId: 3, sender: { kind: "user", id: 7 },   senderDisplayName: "Макс", senderUsername: null, text: "в" },
  ];
  const choices = buildHandleChoices(candidates);
  assert.deepEqual(choices.characters.map(({ character }) => character.subject),
    ["character 42", "character 7"]);
});

test("realizer schema selects an address and a reply message, never a message id", () => {
  assert.ok(realizerDecisionSchema.safeParse(realizerSilence()).success);
  const speak = realizerSpeak({ addressCharacter: "P1", replyToMessage: "M1" });
  assert.ok(realizerDecisionSchema.safeParse(speak).success);
  assert.equal(realizerDecisionSchema.safeParse({
    ...speak, targetMessageId: 912345 }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    action: "silence", motive: "x" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...realizerSilence(), characterIntent: "" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...speak, message: "   " }).success, false);
});

test("the dynamic realizer schema restricts handles to visible candidates", () => {
  const candidates: VisibleMessage[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "привіт" },
  ];
  const schema = buildRealizerResponseSchema(candidates);
  const speak = realizerSpeak({ addressCharacter: "P1", replyToMessage: "M1" });
  assert.equal(schema.safeParse(speak).success, true);
  for (const bad of ["7001", "Юхим", "character 42", "P9", "M9"]) {
    assert.equal(schema.safeParse({ ...speak, addressCharacter: bad }).success,
      false, `addressCharacter=${bad}`);
    assert.equal(schema.safeParse({ ...speak, replyToMessage: bad }).success,
      false, `replyToMessage=${bad}`);
  }
});

test("speak decisions resolve to internal choices and invalid handles fail safely", () => {
  const candidates: VisibleMessage[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "привіт" },
  ];
  const resolved = resolveRealizerDecision(realizerSpeak({
    addressCharacter: "P1", replyToMessage: "M1",
  }), candidates);
  assert.equal(resolved?.address?.character.subject, "character 42");
  assert.equal(resolved?.replyTo?.message.messageId, 912345);
  const missingAddress = resolveRealizerDecision(realizerSpeak({
    addressCharacter: "P9", replyToMessage: null,
  }), candidates);
  assert.equal(missingAddress, undefined);
  const missingReply = resolveRealizerDecision(realizerSpeak({
    addressCharacter: "P1", replyToMessage: "M9",
  }), candidates);
  assert.equal(missingReply, undefined);
});

test("realizer context keeps the dream framing id-free and shows the handles", () => {
  const history = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) }),
  ];
  const rendered = renderRealizerContext(context(history, [
    { messageId: 912345, sender: { kind: "user", id: 42 },   senderDisplayName: "Оля", senderUsername: null, text: "привіт" },
  ]));
  assert.match(rendered, /Character 42 in your notebook has not acquired a natural name yet\.\nTelegram currently displays them as “Оля”\./);
  assert.match(rendered, /Your sleeping mind made character 42 say:/);
  assert.match(rendered, /Character handles \(addressCharacter must be one of these\):\n\nP1 = unnamed character 42/);
  assert.match(rendered, /Reply-message handles \(replyToMessage must be one of these, or null\):\n\nM1 = the first eligible visible message/);
  assert.match(rendered, /This is a group chat, where most messages are not addressed to you/);
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /spreadsheet/);
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
      targetSenderDisplayName: "Новини", targetSenderUsername: null, targetText: "оголошення", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /Your sleeping mind made character 42 reply to the Telegram source channel 500 with:/);
  assert.ok(rendered.includes("та ні"));
  assert.doesNotMatch(rendered, /channel -500/);
});

test("Хевронія's own reply to a Telegram source uses source wording", () => {
  const rendered = renderDreamEvent(ownMessage(912381, "дякую", {
    targetMessageId: 912380, targetSender: { kind: "chat", id: -500 },
    targetSenderDisplayName: "Новини", targetSenderUsername: null, targetText: "оголошення", targetIsHevronia: false,
  }));
  assert.match(rendered, /You previously chose to reply to the Telegram source channel 500 with:/);
  assert.ok(rendered.includes("дякую"));
  assert.doesNotMatch(rendered, /channel -500/);
});

test("the conversation framing names the chat kind once, without singling out the last message", () => {
  assert.match(renderConversationFraming("private"),
    /This is a private chat: every message here is addressed to you/);
  assert.match(renderConversationFraming("group"),
    /This is a group chat, where most messages are not addressed to you/);
  assert.match(renderConversationFraming("supergroup"),
    /This is a group chat, where most messages are not addressed to you/);
  assert.doesNotMatch(renderConversationFraming("group"), /latest message/i);
});

test("each directly addressed participant event carries its own marker", () => {
  const addressed = participant(1, 42, "Оля", "привіт", { directlyAddressed: true });
  const rendered = renderDreamEvent(addressed);
  assert.match(rendered, /This message was addressed to you directly\./);
  const ambient = participant(2, 42, "Оля", "привіт");
  assert.doesNotMatch(renderDreamEvent(ambient), /addressed to you directly/);
});

test("a reply to Хевронія is not double-marked with a directness line", () => {
  const reply = participant(3, 42, "Оля", "та ні", {
    directlyAddressed: true,
    replyTo: { targetMessageId: 2, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetSenderUsername: null, targetText: "ти прийдеш?", targetIsHevronia: true },
  });
  const rendered = renderDreamEvent(reply);
  assert.match(rendered, /reply to one of your earlier messages with:/);
  assert.doesNotMatch(rendered, /addressed to you directly/);
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

test("contexts without memories never claim that memories surfaced", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 42 }, memories: [{ text: "Оля боїться павуків" }] },
    { participant: { kind: "user", id: 17 }, memories: [] },
  ]);
  assert.match(rendered, /character 42/);
  assert.doesNotMatch(rendered, /character 17/);
  assert.doesNotMatch(rendered, /surfaced.*\n\nSome memories|surfaced[\s\S]*character 17/);
  assert.equal(renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 17 }, memories: [] },
  ]), "");
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

test("natural names replace notebook labels in dream rendering", () => {
  const names = new Map<number, string>([[52, "Боб"], [63, "Аня"]]);
  assert.match(renderDreamEvent(participant(1, 52, "SuperBob3000", "привіт"), undefined, names),
    /Your sleeping mind made Боб say:\n\nпривіт/);
  const mesReply = participant(2, 63, "137^WT&^t1g3y", "привіт боб!", {
    replyTo: { targetMessageId: 1, targetSender: { kind: "user", id: 52 },
      targetSenderDisplayName: "SuperBob3000", targetSenderUsername: null,
      targetText: "привіт", targetIsHevronia: false } });
  assert.match(renderDreamEvent(mesReply, undefined, names),
    /Your sleeping mind made Аня reply to Боб with:/);
  const own = ownMessage(3, "і тобі привіт", { targetMessageId: 2,
    targetSender: { kind: "user", id: 52 }, targetSenderDisplayName: "SuperBob3000",
    targetSenderUsername: null, targetText: "привіт боб!", targetIsHevronia: false });
  assert.match(renderDreamEvent(own, undefined, names),
    /You previously chose to reply to Боб with:/);
  assert.match(renderDreamEvent(participant(4, 52, "SuperBob3000", "привіт")),
    /Your sleeping mind made character 52 say:/);
});

test("raw incoming message text is not rewritten by naturalization", () => {
  const names = new Map<number, string>([[52, "Боб"]]);
  const rendered = renderDreamEvent(
    participant(1, 52, "SuperBob3000", "@SuperBob3000 ти де?"), undefined, names,
  );
  assert.ok(rendered.includes("@SuperBob3000 ти де?"));
  assert.match(rendered, /Your sleeping mind made Боб say:/);
});

test("the realizer context carries natural name, notebook identity, Telegram metadata, and handles", () => {
  const names = new Map<number, string>([[52, "Боб"]]);
  const event: ObservedTelegramMessage = { kind: "participant", messageId: 1,
    sender: { kind: "user", id: 52 }, senderDisplayName: "SuperBob3000",
    senderUsername: "super_bob3000", chatKind: "group", text: "привіт",
    messageThreadId: null, replyTo: null, directlyAddressed: false };
  const history = [new HumanMessage({ content: serializeTelegramEvent(event) })];
  const rendered = renderRealizerContext({
    boundedHistory: history,
    currentMessage: event,
    visibleMessages: [{ messageId: 1, sender: { kind: "user", id: 52 },
      senderDisplayName: "SuperBob3000", senderUsername: "super_bob3000", text: "привіт" }],
    participantMemories: [],
    naturalNames: names,
  });
  assert.match(rendered, /Боб, who is character 52 in your notebook\.\nTelegram currently displays them as “SuperBob3000”\.\nTheir Telegram username is @super_bob3000\./);
  assert.match(rendered, /Your sleeping mind made Боб say:/);
  assert.match(rendered, /Character handles \(addressCharacter must be one of these\):\n\nP1 = Боб \(character 52 in your notebook\)/);
  assert.match(rendered, /Reply-message handles \(replyToMessage must be one of these, or null\):\n\nM1 = the first eligible visible message/);
});

test("recalled memory keeps the character N label even when the person has a natural name", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 52 }, memories: [{ text: "Боб любить каву" }] },
  ]);
  assert.match(rendered, /“character 52”/);
  assert.doesNotMatch(rendered, /“Боб”/);
});

test("escapeMessageText replaces newline-like characters with a single space", () => {
  assert.equal(escapeMessageText("a\nb"), "a b");
  assert.equal(escapeMessageText("a\r\nb"), "a b");
  assert.equal(escapeMessageText("a\rb"), "a b");
  assert.equal(escapeMessageText("a\u2028b"), "a b");
  assert.equal(escapeMessageText("a\u2029b"), "a b");
  assert.equal(escapeMessageText("a\u0085b"), "a b");
  assert.equal(escapeMessageText("no newlines here"), "no newlines here");
});

test("participant message newlines are escaped to spaces in dream rendering", () => {
  const rendered = renderDreamEvent(participant(1, 42, "Іра", "перший рядок\nдругий рядок"));
  assert.match(rendered, /^Your sleeping mind made character 42 say:\n\nперший рядок другий рядок$/);
  const textPart = rendered.slice(rendered.indexOf("\n\n") + 2);
  assert.ok(!textPart.includes("\n"));
  assert.ok(!textPart.includes("\r"));
});
