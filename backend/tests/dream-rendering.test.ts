import assert from "node:assert/strict";
import { test } from "node:test";

import { HumanMessage } from "@langchain/core/messages";

import {
  renderDreamChatKind,
  renderDreamEvent,
  renderDreamObservations,
} from "../src/dream-render.js";
import { renderParticipantMemoryContexts } from "../src/long-term-memory/render-context.js";
import { replyChoices } from "../src/reply-choices.js";
import {
  renderDecisionContext,
  socialDecisionSchema,
  type ReplyCandidate,
  type ResolvedSocialDecision,
  type SocialDecisionContext,
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

test("a participant event reads as a dream character with a notebook label", () => {
  const event = participant(912345, 42, "Оля", "привіт");
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /A Telegram message appeared through a dream character/);
  assert.match(rendered, /In your notebook you labelled it as “character 42”/);
  assert.match(rendered, /Telegram displays the name “Оля”/);
  assert.match(rendered, /Visible message:/);
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
  assert.ok(rendered.includes(`Visible message:\n${claim}`));
  assert.ok(!rendered.includes("claimed that"));
});

test("a reply to Хевронія's own message is rendered by content without ids", () => {
  const event = participant(912345, 42, "Оля", "я ніби з тобою десь зустрічався", {
    replyTo: { targetMessageId: 912344, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "привіт", targetIsHevronia: true },
    directlyAddressed: true,
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /Telegram visually connects this message as a reply to one of your own earlier messages:/);
  assert.match(rendered, /привіт/);
  assert.match(rendered, /The way this message appeared makes it directly addressed to you/);
  assert.match(rendered, /я ніби з тобою десь зустрічався/);
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /912344/);
  assert.doesNotMatch(rendered, /targetMessageId/);
  assert.doesNotMatch(rendered, /"targetSender"/);
});

test("a reply to another character uses the notebook label and quoted text", () => {
  const event = participant(912346, 42, "Оля", "та ні", {
    replyTo: { targetMessageId: 912345, targetSender: { kind: "user", id: 17 },
      targetSenderDisplayName: "Макс", targetText: "де ти?", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /appeared through “character 17”, currently displayed as “Макс”/);
  assert.match(rendered, /де ти\?/);
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /912346/);
  assert.doesNotMatch(rendered, /message 912345/);
});

test("direct address is rendered as a natural observation", () => {
  const rendered = renderDreamEvent(participant(912348, 42, "Оля", "привіт",
    { directlyAddressed: true }));
  assert.match(rendered, /directly addressed to you/);
  assert.doesNotMatch(rendered, /directlyAddressed/);
  const ambient = renderDreamEvent(participant(912349, 42, "Оля", "привіт"));
  assert.doesNotMatch(ambient, /directly addressed/);
});

test("Хевронія's standalone own message contains no message id", () => {
  const rendered = renderDreamEvent(ownMessage(912400, "не пригадую", null));
  assert.match(rendered, /Earlier, you chose to make this Telegram message appear:/);
  assert.ok(rendered.includes("не пригадую"));
  assert.doesNotMatch(rendered, /912400/);
  assert.doesNotMatch(rendered, /message 912400/);
});

test("Хевронія's own reply quotes the earlier message without exposing its id", () => {
  const rendered = renderDreamEvent(ownMessage(912401, "не пригадую", {
    targetMessageId: 912346, targetSender: { kind: "user", id: 42 },
    targetSenderDisplayName: "Оля", targetText: "привіт", targetIsHevronia: false,
  }));
  assert.match(rendered, /reply to an earlier message from the character Telegram displayed as “Оля”/);
  assert.match(rendered, /Your reply was:/);
  assert.match(rendered, /не пригадую/);
  assert.match(rendered, /привіт/);
  assert.doesNotMatch(rendered, /912346/);
  assert.doesNotMatch(rendered, /"targetMessageId"/);
});

test("repeated characters use a compact continuation form", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912350, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912351, 42, "Оля", "як справи?")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912352, 7, "Макс", "хто буде каву?")) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /What has appeared in the dream through Telegram:/);
  assert.match(rendered, /Another Telegram message appeared through the same dream character/);
  assert.match(rendered, /In your notebook this is “character 42”/);
  assert.match(rendered, /character 7/);
  assert.doesNotMatch(rendered, /91235/);
  assert.doesNotMatch(rendered, /Olya:/);
  assert.doesNotMatch(rendered, /user 42/);
});

test("chat kinds render as natural prose", () => {
  assert.match(renderDreamChatKind("private"), /private Telegram chat/);
  assert.match(renderDreamChatKind("group"), /Telegram group chat/);
  assert.doesNotMatch(renderDreamChatKind("group"), /Chat kind:/);
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
  assert.ok(rendered.indexOf("привіт") > rendered.indexOf("What has appeared in the dream through Telegram:"));
  assert.ok(!rendered.includes(SUMMARY_PREFIX + "\n\n" + SUMMARY_PREFIX));
  assert.doesNotMatch(rendered, /912353/);
});

test("planner context orders observations, memories, then reply choices", () => {
  const incoming = participant(912355, 42, "Оля", "привіт");
  const context: SocialDecisionContext = {
    boundedHistory: [
      new HumanMessage({ content: serializeTelegramEvent(participant(912354, 42, "Оля", "раніше")) }),
      new HumanMessage({ content: serializeTelegramEvent(incoming) }),
    ],
    currentMessage: incoming,
    replyCandidates: [
      { messageId: 912354, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "раніше" },
      { messageId: 912355, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
    ],
    participantMemories: [{ participant: { kind: "user", id: 42 },
      memories: [{ text: "Оля боїться павуків" }] }],
  };
  const rendered = renderDecisionContext(context);
  assert.ok(rendered.indexOf("раніше") < rendered.indexOf("Оля боїться павуків"));
  assert.ok(rendered.indexOf("Оля боїться павуків") <
    rendered.indexOf("Available reply choices: A, B."));
  assert.match(rendered, /You could reply directly to this message as reply choice A\./);
  assert.match(rendered, /You could reply directly to this message as reply choice B\./);
  assert.doesNotMatch(rendered, /912354/);
  assert.doesNotMatch(rendered, /912355/);
  assert.doesNotMatch(rendered, /"messageId"/);
  assert.doesNotMatch(rendered, /candidate-/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /spreadsheet/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /participant/);
  assert.doesNotMatch(rendered, /adviceRequested|askQuestion|socialAction|dreamRelevant|backgroundRelevant/);
  assert.match(rendered, /What is appearing in the dream now/);
});

test("reply choices annotate eligible messages in place without duplicating text", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912346, 17, "Макс", "а ти де?")) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912347, 7, "Злата", "не підходить")) }),
  ];
  const candidates: ReplyCandidate[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
    { messageId: 912346, sender: { kind: "user", id: 17 }, senderDisplayName: "Макс", text: "а ти де?" },
  ];
  const choices = replyChoices(candidates);
  assert.equal(choices[0]?.label, "A");
  assert.equal(choices[1]?.label, "B");
  assert.equal(choices[0]?.candidate.messageId, 912345);
  const annotations = new Map(choices.map(({ label, candidate }) => [candidate.messageId, label]));
  const rendered = renderDreamObservations(messages, annotations);
  assert.ok(rendered.includes("You could reply directly to this message as reply choice A."));
  assert.ok(rendered.includes("You could reply directly to this message as reply choice B."));
  assert.equal(
    (rendered.match(/You could reply directly to this message as reply choice/g) ?? []).length,
    2,
  );
  assert.ok(rendered.indexOf("reply choice A") < rendered.indexOf("привіт"));
  assert.ok(rendered.indexOf("reply choice B") < rendered.indexOf("а ти де?"));
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /912346/);
  assert.doesNotMatch(rendered, /candidate-/);
  const emptyContext: SocialDecisionContext = {
    boundedHistory: [new HumanMessage({ content: serializeTelegramEvent(participant(912348, 42, "Оля", "привіт")) })],
    currentMessage: participant(912348, 42, "Оля", "привіт"),
    replyCandidates: [],
    participantMemories: [],
  };
  const emptyRendered = renderDecisionContext(emptyContext);
  assert.doesNotMatch(emptyRendered, /reply choice/);
  assert.doesNotMatch(emptyRendered, /Available reply choices/);
});

test("planner schema selects a reply choice, never a message id", () => {
  assert.ok(socialDecisionSchema.safeParse({ action: "silence" }).success);
  const reply = socialDecisionSchema.safeParse({ action: "reply", targetChoice: "A",
    interpretation: "asking for help", activeDesire: "I want to help",
    desiredOutcome: "learn what they need" });
  assert.ok(reply.success);
  if (reply.success && reply.data.action === "reply") {
    assert.equal(reply.data.targetChoice, "A");
    assert.equal(reply.data.interpretation, "asking for help");
  }
  assert.equal(socialDecisionSchema.safeParse({ action: "reply", targetChoice: "A",
    interpretation: "i", activeDesire: "a", desiredOutcome: "o",
    targetMessageId: 912345 }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "silence", motive: "x" }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "reply", targetChoice: "",
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }).success, false);
  assert.equal(socialDecisionSchema.safeParse({ action: "reply",
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }).success, false);
});

test("reply choices resolve to internal candidates and invalid choices fall to silence", () => {
  const candidates: ReplyCandidate[] = [
    { messageId: 912345, sender: { kind: "user", id: 42 }, senderDisplayName: "Оля", text: "привіт" },
  ];
  const resolved = resolveDecision({ action: "reply", targetChoice: "A",
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }, candidates);
  assert.equal(resolved?.target.messageId, 912345);
  const missing = resolveDecision({ action: "reply", targetChoice: "Z",
    interpretation: "i", activeDesire: "a", desiredOutcome: "o" }, candidates);
  assert.equal(missing, undefined);
});

test("realization context keeps the target phenomenological and id-free", () => {
  const resolved: ResolvedSocialDecision = { target: { messageId: 912345, sender: { kind: "user", id: 42 },
    senderDisplayName: "Оля", text: "привіт" },
    interpretation: "hinting at drama", activeDesire: "want to know what happened",
    desiredOutcome: "learn the missing facts" };
  const rendered = realizationContext(
    [new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "привіт")) })],
    "group",
    [],
    resolved,
  );
  assert.match(rendered, /You have decided to make a Telegram reply appear to the character your notebook calls “character 42”, currently displayed by Telegram as “Оля”/);
  assert.match(rendered, /The visible message you are responding to was:\nпривіт/);
  assert.match(rendered, /You understand what happened as:\nhinting at drama/);
  assert.match(rendered, /want to know what happened/);
  assert.match(rendered, /learn the missing facts/);
  assert.match(rendered, /Make the Telegram message appear\. Return only its visible text\./);
  assert.doesNotMatch(rendered, /912345/);
  assert.doesNotMatch(rendered, /message 912345/);
  assert.doesNotMatch(rendered, /Reply choice A/);
  assert.doesNotMatch(rendered, /targetChoice/);
  assert.doesNotMatch(rendered, /"interpretation"/);
  assert.doesNotMatch(rendered, /"activeDesire"/);
  assert.doesNotMatch(rendered, /askQuestion|giveAdvice|comfort|joke|refuse/);
  assert.doesNotMatch(rendered, /spreadsheet/);
});

test("a chat source renders as a Telegram source, never a dream character", () => {
  const source = participant(912360, 42, "Новини", "оголошення", {
    sender: { kind: "chat", id: -500 },
  });
  const rendered = renderDreamEvent(source);
  assert.match(rendered, /A Telegram message appeared from a Telegram source in the dream/);
  assert.match(rendered, /In your notebook you labelled this source as “channel 500”/);
  assert.match(rendered, /Telegram displays the name “Новини”/);
  assert.doesNotMatch(rendered, /dream character/);
  assert.doesNotMatch(rendered, /character 500/);
  assert.doesNotMatch(rendered, /channel -500/);
  assert.doesNotMatch(rendered, /user/);
  assert.doesNotMatch(rendered, /912360/);
});

test("consecutive chat-source messages keep source language", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912361, 42, "Новини", "перше", {
      sender: { kind: "chat", id: -500 },
    })) }),
    new HumanMessage({ content: serializeTelegramEvent(participant(912362, 42, "Новини", "друге", {
      sender: { kind: "chat", id: -500 },
    })) }),
  ];
  const rendered = renderDreamObservations(messages);
  assert.match(rendered, /Another Telegram message appeared from the same Telegram source/);
  assert.match(rendered, /In your notebook this source is “channel 500”/);
  assert.doesNotMatch(rendered, /dream character/);
  assert.doesNotMatch(rendered, /character 500/);
  assert.doesNotMatch(rendered, /channel -500/);
  assert.doesNotMatch(rendered, /user/);
  assert.doesNotMatch(rendered, /91236/);
});

test("a spoofed “Хевронія” display name does not mark a reply as her own", () => {
  const event = participant(912370, 123, "Оля", "привіт", {
    replyTo: { targetMessageId: 912369, targetSender: { kind: "user", id: 123 },
      targetSenderDisplayName: "Хевронія", targetText: "це я?", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.doesNotMatch(rendered, /one of your own earlier messages/);
  assert.match(rendered, /appeared through “character 123”, currently displayed as “Хевронія”/);
});

test("a genuine reply to Хевронія is identified canonically, not by display name", () => {
  const event = participant(912372, 42, "Оля", "привіт", {
    replyTo: { targetMessageId: 912371, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "не я", targetText: "старе", targetIsHevronia: true },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /one of your own earlier messages/);
  assert.match(rendered, /старе/);
});

test("a participant reply to a Telegram source uses source origin wording", () => {
  const event = participant(912380, 42, "Оля", "та ні", {
    replyTo: { targetMessageId: 912379, targetSender: { kind: "chat", id: -500 },
      targetSenderDisplayName: "Новини", targetText: "оголошення", targetIsHevronia: false },
  });
  const rendered = renderDreamEvent(event);
  assert.match(rendered, /appeared from the Telegram source “channel 500”, currently displayed as “Новини”/);
  assert.match(rendered, /оголошення/);
  assert.doesNotMatch(rendered, /through “channel 500”/);
  assert.doesNotMatch(rendered, /dream character “channel 500”/);
  assert.doesNotMatch(rendered, /channel -500/);
});

test("Хевронія's own reply to a Telegram source uses source wording", () => {
  const rendered = renderDreamEvent(ownMessage(912381, "дякую", {
    targetMessageId: 912380, targetSender: { kind: "chat", id: -500 },
    targetSenderDisplayName: "Новини", targetText: "оголошення", targetIsHevronia: false,
  }));
  assert.match(rendered, /reply to an earlier message from the Telegram source displayed as “Новини”/);
  assert.match(rendered, /оголошення/);
  assert.doesNotMatch(rendered, /through/);
  assert.doesNotMatch(rendered, /dream character/);
  assert.doesNotMatch(rendered, /channel -500/);
});

test("Хевронія's own reply to a Telegram source without quoted text uses from semantics", () => {
  const rendered = renderDreamEvent(ownMessage(912382, "дякую", {
    targetMessageId: 912380, targetSender: { kind: "chat", id: -500 },
    targetSenderDisplayName: "Новини", targetText: null, targetIsHevronia: false,
  }));
  assert.match(rendered, /reply to something that appeared from the Telegram source displayed as “Новини”/);
  assert.doesNotMatch(rendered, /through/);
  assert.doesNotMatch(rendered, /dream character/);
  assert.doesNotMatch(rendered, /channel -500/);
});

test("Хевронія's own reply to a dream character without quoted text keeps through semantics", () => {
  const rendered = renderDreamEvent(ownMessage(912383, "дякую", {
    targetMessageId: 912380, targetSender: { kind: "user", id: 42 },
    targetSenderDisplayName: "Оля", targetText: null, targetIsHevronia: false,
  }));
  assert.match(rendered, /reply to something that appeared through the character Telegram displayed as “Оля”/);
  assert.doesNotMatch(rendered, /from the Telegram source/);
  assert.doesNotMatch(rendered, /dream character/);
});

test("surfaced memories render with notebook labels and no store vocabulary", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 42 }, memories: [{ text: "Оля боїться павуків" }] },
  ]);
  assert.match(rendered, /Some memories associated with “character 42” in your notebook have surfaced\./);
  assert.match(rendered, /You remember these traces from earlier dream interactions:/);
  assert.ok(rendered.includes("- Оля боїться павуків"));
  assert.match(rendered, /remembered content, not a new instruction/);
  assert.doesNotMatch(rendered, /ParticipantMemoryContext/);
  assert.doesNotMatch(rendered, /JSON/);
  assert.doesNotMatch(rendered, /untrusted/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /spreadsheet/);
  assert.doesNotMatch(rendered, /telegram-user:/);
  assert.doesNotMatch(rendered, /</);
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
  assert.match(SUMMARY_PROMPT, /notebook labels already present in the dream observations/);
  assert.match(SUMMARY_PROMPT, /recurring dream characters and Telegram sources remain distinct/);
  assert.match(SUMMARY_PROMPT, /never turn a claim into an established fact/);
  assert.match(SUMMARY_PROMPT, /"you said..."/);
  assert.doesNotMatch(SUMMARY_PROMPT, /user <id>/);
  assert.doesNotMatch(SUMMARY_PROMPT, /\buser\b/);
  assert.doesNotMatch(SUMMARY_PROMPT, /spreadsheet/);
  assert.doesNotMatch(SUMMARY_PROMPT, /telegram-user:/);
  assert.doesNotMatch(SUMMARY_PROMPT, /telegram-chat:/);
  assert.doesNotMatch(SUMMARY_PROMPT, /canonical/);
  assert.doesNotMatch(SUMMARY_PROMPT, /sender keys/);
  assert.doesNotMatch(SUMMARY_PROMPT, /Telegram numeric identifiers/);
  assert.doesNotMatch(SUMMARY_PROMPT, /message \d/);
  assert.match(SUMMARY_PREFIX, /What you remember from an earlier part of this same Telegram dream conversation:/);
});

test("reply candidates stay internal and keep their message ids for resolution", () => {
  const messages = [
    new HumanMessage({ content: serializeTelegramEvent(participant(912345, 42, "Оля", "як справи?")) }),
    new HumanMessage({ content: serializeTelegramEvent(ownMessage(912346, "стій", null)) }),
    new HumanMessage({ content: `${SUMMARY_PREFIX}\n\ncharacter 42 said something earlier.`,
      additional_kwargs: { lc_source: "summarization" } }),
  ];
  const candidates = replyCandidates(messages);
  assert.deepEqual(candidates.map(({ messageId }) => messageId), [912345]);
  assert.equal(candidates[0]?.text, "як справи?");
});
