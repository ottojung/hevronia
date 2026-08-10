import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";

import { createConversationLayer } from "../src/layer.js";
import {
  longTermMemoryUserIdFromTelegramSender,
  conversationThreadIdFromTelegramPrivateChat,
} from "../src/identifiers.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  PLANNING_MODE,
  createSocialDecisionMaker,
  subjectiveParagraph,
  type SocialDecision,
  type SocialDecisionLog,
  type SocialDecisionMaker,
  type SubjectiveState,
} from "../src/social-decision.js";
import { createObservedTelegramMessage, hasDirectMention } from "../src/telegram-observation.js";
import { deliverGeneratedTurn } from "../src/telegram-delivery.js";
import { serializeTelegramEvent, type ObservedTelegramMessage } from "../src/telegram-event.js";
import { staticMemory, silenceDecision } from "./memory-fixtures.js";

const threadId = conversationThreadIdFromTelegramPrivateChat(77);

function message(overrides: Partial<ObservedTelegramMessage> = {}): ObservedTelegramMessage {
  return { kind: "participant", messageId: 10, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні", replyTo: null,
    directlyAddressed: false, ...overrides };
}

function speakDecision(
  overrides: Partial<Omit<Exclude<SocialDecision, { action: "silence" }>, "action">> = {},
): Exclude<SocialDecision, { action: "silence" }> {
  return {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    interpretation: "The situation is clear to you.",
    feltState: "This leaves you quietly attentive.",
    activeDesire: "You want to know more about what is happening.",
    desiredOutcome: "You want the missing facts to become known to you.",
    opportunity: "You notice the character is still present and willing to talk.",
    pursuit: "You decide to ask a direct question about it.",
    ...overrides,
  };
}

function subjective(): SubjectiveState {
  return {
    interpretation: "Interpretation sentence.",
    feltState: "Felt state sentence.",
    activeDesire: "Active desire sentence.",
    desiredOutcome: "Desired outcome sentence.",
    opportunity: "Opportunity sentence.",
    pursuit: "Pursuit sentence.",
  };
}

test("private, group-reply, and ambient direct interaction semantics remain distinct", () => {
  const privateMessage = createObservedTelegramMessage({ messageId: 1, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "private", messageThreadId: null, text: "привіт",
    mentionsHevronia: false, replyTo: null });
  const groupReply = createObservedTelegramMessage({ messageId: 2, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні",
    mentionsHevronia: false, replyTo: { targetMessageId: 1, targetSender: { kind: "user", id: 999 },
      targetSenderDisplayName: "Хевронія", targetText: "старе повідомлення", targetsHevronia: true } });
  const ambient = createObservedTelegramMessage({ messageId: 3, sender: { kind: "user", id: 11 },
    senderDisplayName: "Іра", chatKind: "group", messageThreadId: null, text: "та ні",
    mentionsHevronia: false, replyTo: null });
  assert.equal(privateMessage.directlyAddressed, true);
  assert.equal(groupReply.directlyAddressed, true);
  assert.equal(groupReply.replyTo?.targetSender.id, 999);
  assert.equal(ambient.directlyAddressed, false);
});

test("direct mention detection uses Telegram entities rather than raw substrings", () => {
  assert.equal(hasDirectMention("@hevronia_bot привіт", undefined, 999, "hevronia_bot"), false);
  assert.equal(hasDirectMention("@hevronia_bot привіт",
    [{ type: "mention", offset: 0, length: 13 }], 999, "hevronia_bot"), true);
  assert.equal(hasDirectMention("привіт", [{ type: "text_mention", offset: 0,
    length: 6, user: { id: 999 } }], 999, "hevronia_bot"), true);
});

test("real planner receives canonical personality, background, and recalled memory", async () => {
  const model = fakeModel();
  model.respond((messages) => {
    const input = messages.map((item) => typeof item.content === "string" ? item.content : JSON.stringify(item.content)).join("\n");
    assert.match(input, /You are Хевронія/);
    assert.match(input, /Warcraft is part of the dream/);
    assert.match(input, /Character 88, currently displayed by Telegram as “Іра”/);
    assert.match(input, /Your sleeping mind made character 88 say:/);
    assert.match(input, /Planner character handles:\n\nP1 = character 88/);
    assert.match(input, /боїться павуків/);
    assert.doesNotMatch(input, /telegram-user:/);
    assert.doesNotMatch(input, /spreadsheet/);
    assert.doesNotMatch(input, /user 88/);
    assert.doesNotMatch(input, /reply choice/);
    return new AIMessage(JSON.stringify({ decision: silenceDecision() }));
  });
  const planner = createSocialDecisionMaker(model, SYSTEM_PROMPT);
  const current = message();
  await planner.decide({
    boundedHistory: [new HumanMessage({ content: serializeTelegramEvent(current) })],
    currentMessage: current,
    visibleMessages: [{ messageId: 10, sender: { kind: "user", id: 88 },
      senderDisplayName: "Іра", text: "та ні" }], participantMemories: [{
        participant: { kind: "user", id: 88 }, memories: [{ text: "Іра боїться павуків" }],
      }] });
});

test("a non-candidate planner target cannot reach Telegram delivery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-target-"));
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({
    addressCharacter: "P9", replyToMessage: null }) };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    let delivered = false;
    const sent = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { delivered = true; return 100; } });
    assert.deepEqual(sent, { status: "silence" });
    assert.equal(delivered, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("duplicate display names retain distinct stable identities", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-names-"));
  const seen: number[][] = [];
  const planner: SocialDecisionMaker = { decide: async (context) => {
    seen.push(context.visibleMessages.map(({ sender }) => sender.id));
    return silenceDecision();
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: message({ sender: { kind: "user", id: 11 } }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId, message: message({ messageId: 11, sender: { kind: "user", id: 22 } }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.deepEqual(seen.at(-1), [11, 22]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("undelivered text and planner psychology never enter history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-delivery-"));
  const planner: SocialDecisionMaker = { decide: async () => speakDecision() };
  const model = fakeModel();
  model.respond(new AIMessage("недоставлена відповідь"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await assert.rejects(() => deliverGeneratedTurn(turn, {
      showTyping: async () => undefined,
      reply: async () => { throw new Error("Telegram failed"); },
    }));
    const history = JSON.stringify((await layer.getMessages(threadId)).map(({ content }) => content));
    assert.ok(!history.includes("недоставлена відповідь"));
    assert.ok(!history.includes("The situation is clear to you"));
    assert.ok(!history.includes("Make the Telegram message you choose to speak appear"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("onSocialDecision exposes the planner's private decision for logging", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-decision-log-"));
  const logs: SocialDecisionLog[] = [];
  let call = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++call === 1
    ? speakDecision()
    : silenceDecision() };
  const model = fakeModel();
  model.respond(new AIMessage("ага"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner,
    onSocialDecision: (log) => logs.push(log) });
  try {
    await layer.respond({ threadId, message: message({ messageId: 1 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await layer.respond({ threadId, message: message({ messageId: 2 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const first = logs[0];
    assert.equal(first?.action, "speak");
    if (first !== undefined && first.action === "speak") {
      assert.equal(first.addressName, "character 88");
      assert.equal(first.replyToName, null);
      assert.equal(first.interpretation, "The situation is clear to you.");
      assert.equal(first.feltState, "This leaves you quietly attentive.");
    }
    const silence = silenceDecision();
    assert.deepEqual(logs[1], {
      action: "silence",
      interpretation: silence.interpretation,
      feltState: silence.feltState,
      activeDesire: silence.activeDesire,
      desiredOutcome: silence.desiredOutcome,
      opportunity: silence.opportunity,
      pursuit: silence.pursuit,
    });
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("silence and delivered speech persist the same canonical incoming representation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-canonical-"));
  let call = 0;
  const planner: SocialDecisionMaker = { decide: async () => ++call === 1
    ? silenceDecision()
    : speakDecision({ replyToMessage: "M1" }) };
  const model = fakeModel();
  model.respond(new AIMessage("ага"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"), model,
    summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const silent = await layer.respond({ threadId, message: message({ messageId: 1 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    await deliverGeneratedTurn(silent, { showTyping: async () => undefined,
      reply: async () => 100 });
    const reply = await layer.respond({ threadId, message: message({ messageId: 2 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    const sentTexts: string[] = [];
    await deliverGeneratedTurn(reply, { showTyping: async () => undefined,
      reply: async (text) => { sentTexts.push(text); return 101; } });
    const contents = (await layer.getMessages(threadId)).map(({ content }) => String(content));
    assert.match(contents[0] ?? "", /"kind":"participant"/);
    assert.match(contents[1] ?? "", /"kind":"participant"/);
    assert.match(contents[2] ?? "", /"kind":"hevronia"/);
    assert.deepEqual(sentTexts, ["ага"]);
    assert.ok(!sentTexts.join().includes("The situation is clear to you"));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a planner exception fails safely to silence instead of crashing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-planner-crash-"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(),
    decisionMaker: { decide: async () => { throw new Error("planner boom"); } } });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    let delivered = false;
    const sent = await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async () => { delivered = true; return 100; } });
    assert.deepEqual(sent, { status: "silence" });
    assert.equal(delivered, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recalled memory reaches the planner before silence decision", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-recall-"));
  const memory = staticMemory(new Map([
    [longTermMemoryUserIdFromTelegramSender(88).toPersistenceKey(),
      [{ text: "важлива обіцянка" }]],
  ]));
  let recalled = "";
  const planner: SocialDecisionMaker = { decide: async (context) => {
    recalled = context.participantMemories.flatMap(({ memories }) =>
      memories.map(({ text }) => text)).join();
    return silenceDecision();
  } };
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model: fakeModel(), summaryModel: fakeModel(), decisionMaker: planner,
    lazyMemory: memory });
  try {
    await layer.respond({ threadId, message: message(), hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(recalled, "важлива обіцянка");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("speaking to a character without attaching a Telegram reply is delivered with no reply relationship", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-speak-no-reply-"));
  const planner: SocialDecisionMaker = { decide: async () => speakDecision() };
  const model = fakeModel();
  model.respond(new AIMessage("я питаю сам"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo, null);
    await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async (_text, replyToMessageId) => { assert.equal(replyToMessageId, null); return 100; } });
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("speaking with a selected reply message attaches the Telegram reply to that message", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-speak-reply-"));
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({ replyToMessage: "M1" }) };
  const model = fakeModel();
  model.respond(new AIMessage("я відповідаю прикріплено"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message({ messageId: 10 }),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo?.targetMessageId, 10);
    await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async (_text, replyToMessageId) => { assert.equal(replyToMessageId, 10); return 100; } });
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ambient group speech with no addressee and no reply attachment is representable", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-ambient-"));
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({
    addressCharacter: null, replyToMessage: null }) };
  const model = fakeModel();
  model.respond(new AIMessage("це просто думка вголос"));
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "speak");
    if (turn.outcome.action === "speak") assert.equal(turn.outcome.replyTo, null);
    await deliverGeneratedTurn(turn, { showTyping: async () => undefined,
      reply: async (_text, replyToMessageId) => { assert.equal(replyToMessageId, null); return 100; } });
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("silence produces no realization call", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-silence-no-realize-"));
  let invoked = false;
  const model = fakeModel();
  model.respond(() => { invoked = true; return new AIMessage("ніколи"); });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(),
    decisionMaker: { decide: async () => silenceDecision() } });
  try {
    const turn = await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.equal(turn.outcome.action, "silence");
    assert.equal(invoked, false);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer context concatenates the six subjective sentences verbatim in order", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-verbatim-"));
  const state = subjective();
  const expected = [
    state.interpretation, state.feltState, state.activeDesire,
    state.desiredOutcome, state.opportunity, state.pursuit,
  ].join(" ");
  assert.equal(subjectiveParagraph(state), expected);
  let captured = "";
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({
    interpretation: state.interpretation, feltState: state.feltState,
    activeDesire: state.activeDesire, desiredOutcome: state.desiredOutcome,
    opportunity: state.opportunity, pursuit: state.pursuit }) };
  const model = fakeModel();
  model.respond((messages) => {
    captured = messages.map((item) => typeof item.content === "string"
      ? item.content : JSON.stringify(item.content)).join("\n");
    return new AIMessage("ага");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.ok(captured.includes(expected));
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer context exposes no planner internals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-no-internals-"));
  let captured = "";
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({
    addressCharacter: "P1", replyToMessage: "M1" }) };
  const model = fakeModel();
  model.respond((messages) => {
    captured = messages.map((item) => typeof item.content === "string"
      ? item.content : JSON.stringify(item.content)).join("\n");
    return new AIMessage("ага");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.doesNotMatch(captured, /P1/);
    assert.doesNotMatch(captured, /M1/);
    assert.doesNotMatch(captured, /addressCharacter/);
    assert.doesNotMatch(captured, /replyToMessage/);
    assert.doesNotMatch(captured, /"action":\s*"speak"/);
    assert.doesNotMatch(captured, /interpretation:/);
    assert.doesNotMatch(captured, /activeDesire/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the realizer is not instructed to continue the current topic", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-redirect-"));
  let captured = "";
  const planner: SocialDecisionMaker = { decide: async () => speakDecision({
    addressCharacter: "P1", replyToMessage: null,
    interpretation: "This is a technical monologue that means nothing to you.",
    feltState: "This leaves you bored.",
    activeDesire: "You want something here to become genuinely interesting to you.",
    desiredOutcome: "You want to discover something about character 88 that actually changes your experience.",
    opportunity: "You notice character 88 is still present and willing to talk.",
    pursuit: "You decide to discard his debugging agenda and steer him toward a question that interests you instead.",
  }) };
  const model = fakeModel();
  model.respond((messages) => {
    captured = messages.map((item) => typeof item.content === "string"
      ? item.content : JSON.stringify(item.content)).join("\n");
    return new AIMessage("а сам де таке бачив?");
  });
  const layer = createConversationLayer({ dbPath: path.join(dir, "db.sqlite"),
    model, summaryModel: fakeModel(), decisionMaker: planner });
  try {
    await layer.respond({ threadId, message: message(),
      hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false });
    assert.ok(captured.includes("You decide to discard his debugging agenda and steer him toward a question that interests you instead."));
    assert.doesNotMatch(captured, /answer the latest message/);
    assert.doesNotMatch(captured, /respond to the selected message/);
    assert.doesNotMatch(captured, /address the user's question/);
    assert.doesNotMatch(captured, /stay relevant to the current subject/);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the planner protocol does not encode supporting a joke as a goal", () => {
  assert.doesNotMatch(PLANNING_MODE, /support the joke/i);
  assert.doesNotMatch(PLANNING_MODE, /support.*joke/i);
});
