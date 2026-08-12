import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { conversationThreadIdFromTelegramPrivateChat } from "../src/identifiers.js";
import { createLazyLongTermMemory } from "../src/long-term-memory/runtime.js";
import { applyProposedNames } from "../src/natural-names/apply.js";
import { createNaturalNameStore } from "../src/natural-names/store.js";
import { isReactionCancelledError, ReactionCancelledError } from "../src/reaction-cancelled.js";
import type { AttentionPlanner } from "../src/attention-planner.js";
import type { Realizer } from "../src/realizer.js";
import type { TurnContext } from "../src/realizer-schema.js";
import type { TelegramTurnDelivery } from "../src/telegram-delivery.js";
import type { ObservedTelegramMessage } from "../src/telegram-event.js";
import {
  FakeScheduler,
  FakeStore,
  passingPlanner,
  realizerSilence,
  realizerSpeak,
  testLayer,
} from "./memory-fixtures.js";

function tempDir(label: string): string {
  return mkdtempSync(path.join(tmpdir(), `hevronia-react-${label}-`));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("condition was not reached before the wait deadline");
}

const threadId = conversationThreadIdFromTelegramPrivateChat(701);
const otherThreadId = conversationThreadIdFromTelegramPrivateChat(702);

function message(id: number, text: string): ObservedTelegramMessage {
  return { kind: "participant", messageId: id, sender: { kind: "user", id: 88 },
    senderDisplayName: "Іра", senderUsername: null, chatKind: "group", text,
    messageThreadId: null, replyTo: null, directlyAddressed: false };
}

interface Gate {
  signal: AbortSignal | undefined;
  context: TurnContext;
  unblock: () => void;
}

function makePlanner(): { planner: AttentionPlanner; gates: Gate[] } {
  const gates: Gate[] = [];
  const planner: AttentionPlanner = {
    async consider(context: TurnContext, _choices, signal) {
      const gate = deferred();
      gates.push({ signal, context, unblock: () => gate.resolve() });
      signal?.addEventListener("abort", () => gate.resolve(), { once: true });
      await gate.promise;
      if (signal?.aborted) throw new ReactionCancelledError();
      return { attention: true, naturalNames: {} };
    },
  };
  return { planner, gates };
}

function makeIgnoringPlanner(): { planner: AttentionPlanner; gates: Gate[] } {
  // An operation that ignores its AbortSignal and resolves anyway.
  const gates: Gate[] = [];
  const planner: AttentionPlanner = {
    async consider(context: TurnContext, _choices, signal) {
      const gate = deferred();
      gates.push({ signal, context, unblock: () => gate.resolve() });
      await gate.promise;
      return { attention: true, naturalNames: {} };
    },
  };
  return { planner, gates };
}

function makeRealizer(): { realizer: Realizer; gates: Gate[] } {
  const gates: Gate[] = [];
  const realizer: Realizer = {
    async realize(context: TurnContext, signal) {
      const gate = deferred();
      gates.push({ signal, context, unblock: () => gate.resolve() });
      signal?.addEventListener("abort", () => gate.resolve(), { once: true });
      await gate.promise;
      if (signal?.aborted) throw new ReactionCancelledError();
      return realizerSpeak({ message: "реакція" });
    },
  };
  return { realizer, gates };
}

function makeDelivery(): { delivery: TelegramTurnDelivery; sent: string[] } {
  const sent: string[] = [];
  const delivery: TelegramTurnDelivery = {
    showTyping: async () => undefined,
    reply: async (text) => {
      sent.push(text);
      return sent.length;
    },
  };
  return { delivery, sent };
}

function makeBlockingTypingDelivery(): {
  delivery: TelegramTurnDelivery;
  sent: string[];
  typingGates: Array<{ promise: Promise<void>; resolve: () => void }>;
} {
  const sent: string[] = [];
  const typingGates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
  const delivery: TelegramTurnDelivery = {
    showTyping: async () => {
      const gate = deferred();
      typingGates.push(gate);
      await gate.promise;
    },
    reply: async (text) => {
      sent.push(text);
      return sent.length;
    },
  };
  return { delivery, sent, typingGates };
}

function respondInput(id: number, text: string): {
  threadId: typeof threadId;
  message: ObservedTelegramMessage;
  hevroniaSender: { kind: "user"; id: number };
  senderIsBot: boolean;
} {
  return { threadId, message: message(id, text),
    hevroniaSender: { kind: "user", id: 999 }, senderIsBot: false };
}

test("a newer message cancels the previous reaction at the planner and it never delivers", async () => {
  const dir = tempDir("planner-cancel");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    assert.equal(gates[0]?.signal?.aborted, true, "reaction A's signal must be aborted");
    assert.equal(gates[1]?.signal?.aborted, false);
    const historySeenByB = gates[1]?.context.boundedHistory.map((item) =>
      JSON.parse(String(item.content)).text) ?? [];
    assert.deepEqual(historySeenByB, ["A", "B"]);
    for (const gate of gates) gate.unblock();
    await waitFor(() => realizerGates.length === 1);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    assert.deepEqual(sent, ["реакція"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cancelled reaction that resolves anyway is discarded by the revision guard", async () => {
  const dir = tempDir("race");
  const { planner, gates } = makeIgnoringPlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    assert.equal(gates[0]?.signal?.aborted, true);
    for (const gate of gates) gate.unblock();
    await waitFor(() => realizerGates.length === 1);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    assert.deepEqual(sent, ["реакція"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a newer message cancels the previous reaction at the realizer", async () => {
  const dir = tempDir("realizer-cancel");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    gates[0]?.unblock();
    await waitFor(() => realizerGates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    assert.equal(realizerGates[0]?.signal?.aborted, true);
    gates[1]?.unblock();
    await waitFor(() => realizerGates.length === 2);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    assert.deepEqual(sent, ["реакція"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rapid A/B/C: each message persisted once and only the latest reaction can deliver", async () => {
  const dir = tempDir("abc");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    await layer.observe(respondInput(3, "C"), delivery);
    await waitFor(() => gates.length === 3);
    assert.deepEqual(gates.map(({ signal }) => signal?.aborted), [true, true, false]);
    const historySeenByC = gates[2]?.context.boundedHistory.map((item) =>
      JSON.parse(String(item.content)).text) ?? [];
    assert.deepEqual(historySeenByC, ["A", "B", "C"]);
    for (const gate of gates) gate.unblock();
    await waitFor(() => realizerGates.length === 1);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    assert.deepEqual(sent, ["реакція"]);
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.filter((item) => {
      const text = JSON.parse(String(item.content)).text;
      return text === "A" || text === "B" || text === "C";
    }).length, 3, "A, B, C each enter canonical history exactly once");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("typing race: an obsolete reply is never sent after typing resolves past cancellation", async () => {
  const dir = tempDir("typing");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent, typingGates } = makeBlockingTypingDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    gates[0]?.unblock();
    await waitFor(() => realizerGates.length === 1);
    realizerGates[0]?.unblock(); // A speaks, delivery showTyping blocks
    await waitFor(() => typingGates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    assert.equal(realizerGates[0]?.signal?.aborted, true);
    gates[1]?.unblock();
    await waitFor(() => realizerGates.length === 2);
    realizerGates[1]?.unblock();
    await waitFor(() => typingGates.length === 2);
    for (const gate of typingGates) gate.resolve(); // blocked typing resolves
    await layer.settle();
    assert.deepEqual(sent, ["реакція"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a genuine planner failure still fails open; an abort does not", async () => {
  const dir = tempDir("failopen");
  let realized = 0;
  const failingPlanner: AttentionPlanner = {
    consider: async (_context, _choices, signal) => {
      if (signal?.aborted) throw new ReactionCancelledError();
      throw new Error("planner boom");
    },
  };
  const realizer: Realizer = {
    realize: async () => { realized += 1; return realizerSilence(); },
  };
  const { delivery } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: failingPlanner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await layer.settle();
    assert.equal(realized, 1, "a genuine planner failure fails open to the realizer");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancellation across threads is independent", async () => {
  const dir = tempDir("threads");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe({ ...respondInput(1, "X"), threadId: otherThreadId }, delivery);
    await waitFor(() => gates.length === 2);
    // A new event in thread A must not cancel the other thread's reaction.
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 3);
    assert.equal(gates[0]?.signal?.aborted, true, "thread A reaction A is cancelled");
    assert.equal(gates[1]?.signal?.aborted, false, "other thread's reaction is untouched");
    for (const gate of gates) gate.unblock();
    await waitFor(() => realizerGates.length === 2);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    assert.equal(sent.length, 2);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a later participant message after a Хевронія reply keeps plain chronological history", async () => {
  const dir = tempDir("chronology");
  const { planner, gates } = makePlanner();
  const realizer = { realize: async () => realizerSilence() };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    const quietDelivery = { showTyping: async () => undefined, reply: async () => 1 };
    await layer.observe(respondInput(1, "A"), quietDelivery);
    await waitFor(() => gates.length === 1);
    gates[0]?.unblock();
    await layer.settle();
    // Хевронія's own delivered reply becomes part of the canonical history.
    layer.recordDeliveredMessage(threadId, {
      kind: "hevronia", messageId: 50, sender: { kind: "user", id: 999 },
      senderDisplayName: "Хевронія", senderUsername: null, chatKind: "group",
      text: "моя відповідь", messageThreadId: null, replyTo: null,
    });
    await layer.observe(respondInput(2, "B"), quietDelivery);
    await waitFor(() => gates.length === 2);
    gates[1]?.unblock();
    await layer.settle();
    const seen = await layer.getMessages(threadId);
    const texts = seen.map((item) => JSON.parse(String(item.content)).text ?? "");
    assert.deepEqual(texts, ["A", "моя відповідь", "B"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shutdown aborts a blocked reaction and settles without post-close access", async () => {
  const dir = tempDir("shutdown");
  const { planner, gates } = makePlanner();
  const { realizer } = makeRealizer();
  const { delivery, sent } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  await layer.observe(respondInput(1, "A"), delivery);
  await waitFor(() => gates.length === 1);
  assert.equal(gates[0]?.signal?.aborted, false);
  await layer.close(); // aborts the blocked reaction and settles it
  assert.equal(gates[0]?.signal?.aborted, true, "shutdown aborts active reactions");
  gates[0]?.unblock();
  await tick();
  assert.deepEqual(sent, []);
});

test("each incoming message is observed by long-term memory once regardless of cancellation", async () => {
  const dir = tempDir("memory-once");
  const store = new FakeStore();
  const scheduler = new FakeScheduler();
  const memory = createLazyLongTermMemory({ store, scheduler, idleDelayMs: 5 });
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery } = makeDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"),
    { planner, realizer, lazyMemory: memory });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    for (const gate of gates) gate.unblock();
    await waitFor(() => realizerGates.length === 1);
    for (const realizerGate of realizerGates) realizerGate.unblock();
    await layer.settle();
    await scheduler.fireAll();
    assert.deepEqual(store.rememberCalls.flatMap(({ texts }) => texts), ["A", "B"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a confirmed outgoing send is persisted even when a newer message arrives mid-send", async () => {
  const dir = tempDir("commit-race");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const sent: string[] = [];
  const replyGates: Array<{ resolve: () => void }> = [];
  const delivery: TelegramTurnDelivery = {
    showTyping: async () => undefined,
    reply: async (text) => {
      sent.push(text);
      const gate = deferred();
      replyGates.push({ resolve: () => gate.resolve() });
      await gate.promise;
      return sent.length;
    },
  };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    gates[0]?.unblock();
    await waitFor(() => realizerGates.length === 1);
    realizerGates[0]?.unblock(); // A speaks; reply() begins and blocks
    await waitFor(() => replyGates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await tick();
    assert.equal(gates.length, 1, "the replacement reaction waits for the committed send");
    replyGates[0]?.resolve(); // Telegram confirms A's send
    await waitFor(() => gates.length === 2);
    gates[1]?.unblock();
    await waitFor(() => realizerGates.length === 2);
    realizerGates[1]?.unblock();
    await waitFor(() => replyGates.length === 2);
    replyGates[1]?.resolve();
    await layer.settle();
    const stored = await layer.getMessages(threadId);
    const texts = stored.map((item) => JSON.parse(String(item.content)).text ?? "");
    assert.deepEqual(texts, ["A", "B", "реакція", "реакція"],
      "the confirmed send is canonical, exactly once, in chronological order");
    const historySeenByB = gates[1]?.context.boundedHistory.map((item) =>
      JSON.parse(String(item.content)).text) ?? [];
    assert.deepEqual(historySeenByB, ["A", "B", "реакція"],
      "B's reaction starts after A's confirmed delivery is canonical");
    assert.deepEqual(sent, ["реакція", "реакція"]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reaction cancelled before the send commit never calls Telegram reply", async () => {
  const dir = tempDir("pre-commit");
  const { planner, gates } = makePlanner();
  const { realizer, gates: realizerGates } = makeRealizer();
  const { delivery, sent, typingGates } = makeBlockingTypingDelivery();
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery);
    await waitFor(() => gates.length === 1);
    gates[0]?.unblock();
    await waitFor(() => realizerGates.length === 1);
    realizerGates[0]?.unblock(); // A reaches showTyping and blocks
    await waitFor(() => typingGates.length === 1);
    await layer.observe(respondInput(2, "B"), delivery);
    await waitFor(() => gates.length === 2);
    gates[1]?.unblock();
    await waitFor(() => realizerGates.length === 2);
    realizerGates[1]?.unblock();
    await waitFor(() => typingGates.length === 2);
    for (const gate of typingGates) gate.resolve(); // blocked typing resolves
    await layer.settle();
    assert.deepEqual(sent, ["реакція"], "A never reaches the send; only B's reply is sent");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed Telegram send persists nothing and triggers genuine fallback", async () => {
  const dir = tempDir("send-failure");
  const failures: unknown[] = [];
  const realizer = { realize: async () => realizerSpeak({ message: "х" }) };
  const delivery: TelegramTurnDelivery = {
    showTyping: async () => undefined,
    reply: async () => { throw new Error("Telegram unavailable"); },
  };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: passingPlanner(), realizer });
  try {
    await layer.observe(respondInput(1, "A"), delivery, async (error) => { failures.push(error); });
    await layer.settle();
    assert.equal(failures.length, 1);
    const stored = await layer.getMessages(threadId);
    assert.equal(stored.filter((item) => JSON.parse(String(item.content)).text === "х").length, 0,
      "a failed send persists no outgoing event");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a genuine current-reaction failure delivers a persisted fallback", async () => {
  const dir = tempDir("fallback-genuine");
  const failures: unknown[] = [];
  const fallbackSent: string[] = [];
  const realizer = { realize: async () => { throw new Error("realizer boom"); } };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: passingPlanner(), realizer });
  try {
    await layer.observe(respondInput(1, "A"), {
      showTyping: async () => undefined,
      reply: async (text) => { fallbackSent.push(text); return 900; },
    }, async (error, ctx) => {
      failures.push(error);
      try {
        ctx.throwIfStale();
      } catch {
        return;
      }
      const id = await (async () => {
        const text = "Щось я зараз зависла. Спробуй ще раз за хвилину.";
        fallbackSent.push(text);
        return 900;
      })();
      layer.recordDeliveredMessage(threadId, {
        kind: "hevronia", messageId: id, sender: { kind: "user", id: 999 },
        senderDisplayName: "Хевронія", senderUsername: null, chatKind: "group",
        text: "Щось я зараз зависла. Спробуй ще раз за хвилину.",
        messageThreadId: null, replyTo: null,
      });
    });
    await layer.settle();
    assert.equal(failures.length, 1);
    assert.equal(fallbackSent.length, 1);
    const stored = await layer.getMessages(threadId);
    const texts = stored.map((item) => JSON.parse(String(item.content)).text ?? "");
    assert.deepEqual(texts, ["A", "Щось я зараз зависла. Спробуй ще раз за хвилину."]);
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stale detached failure after cancellation sends no fallback", async () => {
  const dir = tempDir("fallback-stale");
  const failures: unknown[] = [];
  const realizerGates: Array<{ unblock: () => void }> = [];
  const realizer: Realizer = {
    realize: async () => {
      const gate = deferred();
      realizerGates.push({ unblock: () => gate.resolve() });
      await gate.promise;
      throw new Error("realizer boom after cancel");
    },
  };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: passingPlanner(), realizer });
  try {
    await layer.observe(respondInput(1, "A"), makeDelivery().delivery,
      async (error) => { failures.push(error); });
    await waitFor(() => realizerGates.length === 1);
    await layer.observe(respondInput(2, "B"), makeDelivery().delivery,
      async (error) => { failures.push(error); });
    await waitFor(() => realizerGates.length === 2);
    for (const gate of realizerGates) gate.unblock();
    await layer.settle();
    assert.equal(failures.length, 1, "only the current reaction's failure triggers fallback");
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shutdown waits for an obsolete reaction that ignores its signal", async () => {
  const dir = tempDir("forgotten-task");
  const { planner, gates } = makeIgnoringPlanner();
  const realizer = { realize: async () => realizerSilence() };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner, realizer });
  await layer.observe(respondInput(1, "A"), makeDelivery().delivery);
  await waitFor(() => gates.length === 1);
  await layer.observe(respondInput(2, "B"), makeDelivery().delivery);
  await waitFor(() => gates.length === 2);
  gates[1]?.unblock(); // B settles; A is still physically running
  await tick();
  await tick();
  let closed = false;
  const closing = layer.close().then(() => { closed = true; });
  await tick();
  assert.equal(closed, false, "close must wait for the obsolete reaction to settle");
  gates[0]?.unblock();
  await closing;
  assert.equal(closed, true);
  rmSync(dir, { recursive: true, force: true });
});

test("shutdown cancellation produces no fallback", async () => {
  const dir = tempDir("shutdown-fallback");
  const failures: unknown[] = [];
  const realizerGates: Array<{ unblock: () => void }> = [];
  const realizer: Realizer = {
    realize: async (_context, signal) => {
      const gate = deferred();
      realizerGates.push({ unblock: () => gate.resolve() });
      signal?.addEventListener("abort", () => gate.resolve(), { once: true });
      await gate.promise;
      if (signal?.aborted) throw new ReactionCancelledError();
      throw new Error("boom");
    },
  };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: passingPlanner(), realizer });
  await layer.observe(respondInput(1, "A"), makeDelivery().delivery,
    async (error) => { failures.push(error); });
  await waitFor(() => realizerGates.length === 1);
  await layer.close(); // aborts the blocked realizer; cancellation is silent
  assert.equal(failures.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("a stale planner naming proposal cannot begin durable assignment after invalidation", async () => {
  const dir = tempDir("stale-naming");
  const gates: Array<{ signal: AbortSignal | undefined; unblock: () => void }> = [];
  let call = 0;
  const ignoringPlanner: AttentionPlanner = {
    consider: async (_context, _choices, signal): Promise<import("../src/attention-planner.js").PlannerDecision> => {
      const gate = deferred();
      gates.push({ signal, unblock: () => gate.resolve() });
      await gate.promise;
      call += 1;
      return call === 1
        ? { attention: true, naturalNames: { P1: "Стелла" } }
        : { attention: true, naturalNames: {} };
    },
  };
  const realizer = { realize: async () => realizerSilence() };
  const layer = testLayer(path.join(dir, "db.sqlite"), { planner: ignoringPlanner, realizer });
  try {
    await layer.observe(respondInput(1, "A"), makeDelivery().delivery);
    await waitFor(() => gates.length === 1);
    await layer.observe(respondInput(2, "B"), makeDelivery().delivery);
    await waitFor(() => gates.length === 2);
    gates[0]?.unblock(); // A's stale planner resolves with a naming proposal
    gates[1]?.unblock();
    await layer.settle();
    const names = createNaturalNameStore(path.join(dir, "natural-names.sqlite"));
    try {
      assert.equal(await names.get(88), undefined, "the stale proposal must not be persisted");
    } finally {
      await names.close();
    }
  } finally {
    await layer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyProposedNames stops before a stale second assignment", async () => {
  const written: string[] = [];
  const store: import("../src/natural-names/store.js").NaturalNameStore = {
    assignIfAbsent: async (_userId, name) => { written.push(name); return name; },
    get: async () => undefined,
    getMany: async () => new Map(),
    close: async () => undefined,
  };
  const choices: import("../src/planner-schema.js").MissingNaturalNameChoice[] = [
    { handle: "P1", sender: { kind: "user", id: 1 }, displayName: "A", username: null },
    { handle: "P2", sender: { kind: "user", id: 2 }, displayName: "B", username: null },
  ];
  let guardCalls = 0;
  try {
    await applyProposedNames(store, choices, { P1: "Оля", P2: "Макс" }, new Map(), () => {
      guardCalls += 1;
      if (guardCalls >= 2) throw new ReactionCancelledError();
    });
    assert.fail("expected cancellation");
  } catch (error) {
    assert.equal(isReactionCancelledError(error), true);
  }
  assert.deepEqual(written, ["Оля"], "the first atomic write may remain; the second must not start");
});
