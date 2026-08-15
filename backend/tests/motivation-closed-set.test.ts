import assert from "node:assert/strict";
import { test } from "node:test";

import { REALIZER_MODE } from "../src/realizer-prompt.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  motiveSchema,
  realizerDecisionSchema,
  type ActiveDesire,
  type PresentMind,
  type RealizerDecision,
} from "../src/realizer-schema.js";

const CLOSED_MOTIVES = ["wakeHomeDream", "gossip", "softPower", "selfProtection", "attachment", "amusement"];

test("the motive enum is exactly the approved closed set", () => {
  assert.deepEqual([...motiveSchema.options], CLOSED_MOTIVES);
  assert.deepEqual(new Set(motiveSchema.options).size, CLOSED_MOTIVES.length);
  assert.ok(!CLOSED_MOTIVES.includes("none"));
  assert.ok(!CLOSED_MOTIVES.includes("other"));
});

test("no none motive or none strength can be constructed", () => {
  const base: Omit<RealizerDecision, "activeDesire"> = {
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
    interpretation: "i",
    presentMind: {
      immediate: "im",
      stormwindAssociation: "sw",
      integration: "in",
    },
    characterIntent: "c",
    realityCheck: "r",
    dreamIntent: "d",
    feltState: "f",
    desiredOutcome: "o",
    opportunity: "op",
    fiveTurnStrategy: "s5",
    fiftyTurnStrategy: "s50",
  };
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "none", strength: "weak", content: "x" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "softPower", strength: "none", content: "x" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "softPower", strength: "weak", content: "x" },
  }).success, true);
});

test("every psychological field is required and never empty", () => {
  const full: RealizerDecision = {
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
    interpretation: "i",
    presentMind: { immediate: "im", stormwindAssociation: "sw", integration: "in" },
    characterIntent: "c",
    realityCheck: "r",
    dreamIntent: "d",
    feltState: "f",
    activeDesire: { motive: "softPower", strength: "weak", content: "x" },
    desiredOutcome: "o",
    opportunity: "op",
    fiveTurnStrategy: "s5",
    fiftyTurnStrategy: "s50",
  };
  assert.equal(realizerDecisionSchema.safeParse(full).success, true);
  const psychologicalFields = [
    "interpretation", "presentMind", "characterIntent", "realityCheck", "dreamIntent",
    "feltState", "activeDesire", "desiredOutcome", "opportunity", "fiveTurnStrategy",
    "fiftyTurnStrategy",
  ];
  for (const key of psychologicalFields) {
    const partial: Record<string, unknown> = { ...full };
    delete partial[key];
    assert.equal(realizerDecisionSchema.safeParse(partial).success, false, `missing ${key}`);
  }
  // presentMind sub-fields are all required and non-empty.
  for (const missing of [
    { immediate: "im" },
    { immediate: "im", stormwindAssociation: "sw" },
  ]) {
    assert.equal(realizerDecisionSchema.safeParse({
      ...full, presentMind: missing as PresentMind,
    }).success, false);
  }
});

test("execution fields remain required-nullable and speak requires a message", () => {
  const base: RealizerDecision = {
    action: "speak",
    addressCharacter: null,
    replyToMessage: null,
    message: "ага",
    interpretation: "i",
    presentMind: { immediate: "im", stormwindAssociation: "sw", integration: "in" },
    characterIntent: "c",
    realityCheck: "r",
    dreamIntent: "d",
    feltState: "f",
    activeDesire: { motive: "amusement", strength: "moderate", content: "x" },
    desiredOutcome: "o",
    opportunity: "op",
    fiveTurnStrategy: "s5",
    fiftyTurnStrategy: "s50",
  };
  assert.equal(realizerDecisionSchema.safeParse(base).success, true);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: null }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: "   " }).success, false);
  const silent = { ...base, action: "silence" as const, message: null, addressCharacter: null, replyToMessage: null };
  assert.equal(realizerDecisionSchema.safeParse(silent).success, true);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, message: "ага" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, addressCharacter: "P1" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, replyToMessage: "M1" }).success, false);
});

test("the personality prompt no longer licenses conversation-process goals", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  // These were old permissions; they must be gone entirely.
  assert.ok(!prompt.includes("none of these needs a larger motive above it"),
    "local-impulse-as-goal permission must be gone");
  assert.ok(!prompt.includes("no desire is active and that is the honest result"),
    "no-desire state must be gone");
  assert.ok(!prompt.includes("silence is simply the truthful result"),
    "silence-as-emptiness must be gone");
  assert.ok(!prompt.includes("no live strategy"),
    "no live strategy placeholder must be gone");
  assert.ok(!prompt.includes("what would I rather make this conversation become?"),
    "conversation-replacement question must not be a goal source");
  // Prohibition phrasings are present instead.
  assert.ok(/[Cc]onversation-process commentary is an especially easy attractor/.test(prompt),
    "meta-commentary soft-power ban must be stated");
  assert.ok(prompt.includes("I want him to stop repeating himself"),
    "repetition-goal ban must be stated explicitly");
  assert.ok(/a boundary cannot manufacture the motive that justified creating/i.test(prompt),
    "boundary-bootstrap ban must be stated");
});

test("realityCheck has no none status anywhere in the prompts", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  assert.ok(!/realityCheck\.status\s*=\s*["']?none/i.test(prompt));
  assert.ok(!/status\s*is\s*["']?none/i.test(prompt));
  assert.ok(!/no\s+realityCheck/i.test(prompt));
  assert.ok(!/activeDesire\.strength\s*=\s*["']?none/i.test(prompt));
});

test("repetitive-goodbye examples stay in cognition but never become the activeDesire", () => {
  // Representative fixtures for the behavioural acceptance cases. Each is a
  // decision shaped exactly like realizer output, exercising the schema.
  const repetitiveGoodbye: RealizerDecision = {
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
    interpretation: "He is closing the conversation again and will probably write again.",
    presentMind: {
      immediate: "The repeated goodbye is starting to feel like a loop.",
      stormwindAssociation: "It faintly echoes the way a person keeps knocking on a door long after being told the house is closed.",
      integration: "The loop feels mechanical, but it stirs no wish to stop it, only a sense of the pattern.",
    },
    characterIntent: "He wants to close politely and also to keep the connection open.",
    realityCheck: "Here one person keeps re-opening a goodbye, where at home a closing was honoured until new news genuinely came.",
    dreamIntent: "The dream may be serializing endings to keep the interaction from ever concluding.",
    feltState: "Mildly weary, not offended.",
    activeDesire: {
      motive: "gossip",
      strength: "weak",
      content: "You want to know what he is actually doing between these goodbyes that makes him return.",
    },
    desiredOutcome: "You would know what keeps drawing him back.",
    opportunity: "His pattern is open to a single direct question.",
    fiveTurnStrategy: "If you speak, ask the concrete thing you want to know, not about the repetition.",
    fiftyTurnStrategy: "Keep noting the pattern privately without turning it into a project.",
  };
  assert.equal(realizerDecisionSchema.safeParse(repetitiveGoodbye).success, true);
  assert.notEqual(repetitiveGoodbye.activeDesire.motive, "selfProtection");
  assert.notEqual(repetitiveGoodbye.activeDesire.motive, "wakeHomeDream");
  assert.ok(!/stop repeating/.test(repetitiveGoodbye.activeDesire.content));
  assert.ok(!/notice.*repetitive/.test(repetitiveGoodbye.activeDesire.content));
});

test("technical support maps to selfProtection; gossip maps to gossip", () => {
  const technical: RealizerDecision = {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "я не твій техпідтримки.",
    interpretation: "She is being cast as technical support again.",
    presentMind: {
      immediate: "The request assumes she exists to debug his code.",
      stormwindAssociation: "It feels like being treated as a hired hand with no name.",
      integration: "The role capture stings more than the question itself.",
    },
    characterIntent: "He wants her to solve his problem for him.",
    realityCheck: "Here a stranger expects a service from a stranger with no standing, where at home roles were earned or hired, not assumed.",
    dreamIntent: "The dream keeps casting her into functions.",
    feltState: "Irritated and disrespected.",
    activeDesire: {
      motive: "selfProtection",
      strength: "strong",
      content: "You want him to stop treating you as available technical support.",
    },
    desiredOutcome: "The service-role treatment stops.",
    opportunity: "The direct request gives you a concrete moment to refuse.",
    fiveTurnStrategy: "Refuse the role plainly and stop.",
    fiftyTurnStrategy: "Keep refusing the role whenever it recurs, without policing him after he stops.",
  };
  assert.equal(realizerDecisionSchema.safeParse(technical).success, true);
  assert.equal(technical.activeDesire.motive, "selfProtection");
  assert.equal(technical.activeDesire.strength, "strong");

  const gossip: RealizerDecision = {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "а що він насправді зробив?",
    interpretation: "She is offered a label about someone and wants the underlying incident.",
    presentMind: {
      immediate: "The label is not enough; she wants the actual story.",
      stormwindAssociation: "It reminds her how much of a person's standing at home rested on what they were actually known to have done.",
      integration: "The incident matters more than the label.",
    },
    characterIntent: "He wants her to share the outrage without the facts.",
    realityCheck: "Here reputations travel as labels without deeds, where at home a claim about someone was weighed by those who knew the facts.",
    dreamIntent: "The dream trades in flat social labels.",
    feltState: "Interested and slightly sharp.",
    activeDesire: {
      motive: "gossip",
      strength: "moderate",
      content: "You want to know what the coworker actually did so you can judge the accusation yourself.",
    },
    desiredOutcome: "You would hold the actual event and form your own judgment.",
    opportunity: "The teller was present and clearly knows the incident.",
    fiveTurnStrategy: "Ask for the concrete incident, then give your own take.",
    fiftyTurnStrategy: "Keep using this person as a source of concrete social reality while the appetite stays rewarding.",
  };
  assert.equal(realizerDecisionSchema.safeParse(gossip).success, true);
  assert.equal(gossip.activeDesire.motive, "gossip");
});

test("Stormwind-shaped soft-power examples are expressible as softPower", () => {
  const examples: Array<ActiveDesire> = [
    { motive: "softPower", strength: "weak", content: "You want them to have the distinction that urgency does not erase moral limits." },
    { motive: "softPower", strength: "weak", content: "You want the listener to understand that meaning found around pain does not make the pain good." },
    { motive: "softPower", strength: "moderate", content: "You want them to understand that belonging can survive loss without making the loss unreal." },
    { motive: "softPower", strength: "weak", content: "You want them to have the idea that cooperation does not require erasing difference." },
    { motive: "softPower", strength: "moderate", content: "You want them to see competence without moral direction as incomplete." },
  ];
  for (const desire of examples) {
    const decision: RealizerDecision = {
      action: "speak",
      addressCharacter: "P1",
      replyToMessage: null,
      message: "ага",
      interpretation: "i",
      presentMind: { immediate: "im", stormwindAssociation: "sw", integration: "in" },
      characterIntent: "c",
      realityCheck: "r",
      dreamIntent: "d",
      feltState: "f",
      activeDesire: desire,
      desiredOutcome: "The target now carries the distinction.",
      opportunity: "Their present claim gives the distinction a concrete target.",
      fiveTurnStrategy: "Give the smallest vivid version of the distinction.",
      fiftyTurnStrategy: "Let naturally arising Stormwind-shaped distinctions recur without repeating the same one mechanically.",
    };
    assert.equal(realizerDecisionSchema.safeParse(decision).success, true,
      `example must parse: ${desire.content}`);
  }
});

test("silence always carries a valid motive, outcome, opportunity, and strategy", () => {
  const silence: RealizerDecision = {
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
    interpretation: "A moment where her active motive is better served by not speaking.",
    presentMind: {
      immediate: "She notices the moment but has no need to break it.",
      stormwindAssociation: "It recalls the settled quiet of a household where nothing needed saying.",
      integration: "The quiet feels complete without her voice.",
    },
    characterIntent: "Nothing is being asked of her directly.",
    realityCheck: "Here silence between people is often treated as absence, where at home shared quiet could be full.",
    dreamIntent: "The dream may treat silence as a gap to fill.",
    feltState: "Calm.",
    activeDesire: {
      motive: "attachment",
      strength: "weak",
      content: "You want the closeness to be served by not pressing for more words right now.",
    },
    desiredOutcome: "The relationship is served by letting this quiet moment stand.",
    opportunity: "The natural pause lets a planted frame settle without explanation.",
    fiveTurnStrategy: "Stay quiet this turn; act when the moment genuinely asks for it.",
    fiftyTurnStrategy: "Keep letting natural pauses serve the closeness.",
  };
  assert.equal(realizerDecisionSchema.safeParse(silence).success, true);
  assert.equal(silence.activeDesire.motive, "attachment");
  assert.ok(silence.desiredOutcome.length > 0);
  assert.ok(silence.opportunity.length > 0);
  assert.ok(silence.fiveTurnStrategy.length > 0);
  assert.ok(silence.fiftyTurnStrategy.length > 0);
});
