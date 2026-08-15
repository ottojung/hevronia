import assert from "node:assert/strict";
import { test } from "node:test";

import { REALIZER_MODE } from "../src/realizer-prompt.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  activeDesireSchema,
  motiveSchema,
  presentMindSchema,
  realityRelationSchema,
  realizerDecisionSchema,
  type ActiveDesire,
  type RealizerDecision,
} from "../src/realizer-schema.js";

const CLOSED_MOTIVES = ["wakeHomeDream", "gossip", "softPower", "selfProtection", "attachment", "amusement"];

function baseDecision(activeDesire: ActiveDesire): RealizerDecision {
  return {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "ага",
    interpretation: "i",
    presentMind: {
      immediate: "im",
      culturalThought: "ct",
      foreground: "fg",
    },
    characterIntent: "c",
    realityRelation: { kind: "difference", content: "r" },
    dreamIntent: "d",
    feltState: "f",
    activeDesire,
    desiredOutcome: "o",
    opportunity: "op",
    fiveTurnStrategy: "s5",
    fiftyTurnStrategy: "s50",
  };
}

test("the motive enum is exactly the approved closed set", () => {
  assert.deepEqual([...motiveSchema.options], CLOSED_MOTIVES);
  assert.deepEqual(new Set(motiveSchema.options).size, CLOSED_MOTIVES.length);
  assert.ok(!CLOSED_MOTIVES.includes("none"));
  assert.ok(!CLOSED_MOTIVES.includes("other"));
});

test("no none motive or none strength can be constructed", () => {
  const valid: ActiveDesire = { motive: "softPower", strength: "weak", content: "x", basis: "b" };
  const base = baseDecision(valid);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "none", strength: "weak", content: "x", basis: "b" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "softPower", strength: "none", content: "x", basis: "b" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse(base).success, true);
});

test("every decision field is required; there are no optional fields", () => {
  const full = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse(full).success, true);
  const allKeys = [
    "interpretation", "presentMind", "characterIntent", "realityRelation", "dreamIntent",
    "feltState", "activeDesire", "desiredOutcome", "opportunity", "fiveTurnStrategy",
    "fiftyTurnStrategy", "action", "message", "addressCharacter", "replyToMessage",
  ];
  for (const key of allKeys) {
    const partial: Record<string, unknown> = { ...full };
    delete partial[key];
    assert.equal(realizerDecisionSchema.safeParse(partial).success, false, `missing ${key}`);
  }
  assert.deepEqual(Object.keys(presentMindSchema.shape).sort(),
    ["culturalThought", "foreground", "immediate"]);
  assert.deepEqual(Object.keys(activeDesireSchema._def.schema.shape).sort(),
    ["basis", "content", "motive", "strength"]);
  assert.deepEqual(Object.keys(realityRelationSchema.shape).sort(), ["content", "kind"]);
});

test("activeDesire.basis is required and non-empty", () => {
  const base = baseDecision({ motive: "gossip", strength: "moderate", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x" },
  }).success, false, "missing basis");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "   " },
  }).success, false, "blank basis");
});

test("presentMind fields are all required and non-empty; old stormwindAssociation and integration are gone", () => {
  const base = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b" });
  const shape = presentMindSchema.shape;
  assert.ok(!("stormwindAssociation" in shape), "stormwindAssociation must be removed");
  assert.ok(!("integration" in shape), "integration must be removed");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: "ct" },
  }).success, false, "missing foreground");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: "   ", foreground: "fg" },
  }).success, false, "blank culturalThought");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: "ct", foreground: "fg" },
  }).success, true);
});

test("realityRelation kind is required and exactly difference | correspondence | distortion", () => {
  assert.deepEqual(realityRelationSchema.shape["kind"].options, ["difference", "correspondence", "distortion"]);
  const base = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "none", content: "x" },
  }).success, false, "none kind invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "difference" },
  }).success, false, "missing content");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, realityRelation: { kind: "correspondence", content: "r" },
  }).success, true);
});

test("amusement with weak strength is rejected; moderate and strong are accepted", () => {
  const weak = baseDecision({ motive: "amusement", strength: "weak", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse(weak).success, false, "weak amusement invalid");
  const moderate = baseDecision({ motive: "amusement", strength: "moderate", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse(moderate).success, true);
  const strong = baseDecision({ motive: "amusement", strength: "strong", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse(strong).success, true);
});

test("execution fields remain required-nullable and speak requires a message", () => {
  const base = baseDecision({ motive: "amusement", strength: "moderate", content: "x", basis: "b" });
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: null }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...base, message: "   " }).success, false);
  const silent: RealizerDecision = {
    ...base, action: "silence", message: null, addressCharacter: null, replyToMessage: null,
  };
  assert.equal(realizerDecisionSchema.safeParse(silent).success, true);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, message: "ага" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, addressCharacter: "P1" }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({ ...silent, replyToMessage: "M1" }).success, false);
});

test("the personality prompt no longer licenses motive laundering", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  assert.ok(!prompt.includes("keep generating until one fits"), "laundering permission must be gone");
  assert.ok(prompt.includes("never make the current event fit a motive merely because one must exist")
    || /[Nn]ever make the current event fit a motive/.test(prompt),
  "anti-laundering rule must be present");
  assert.ok(/no cognitive delta, no local soft-power pursuit/i.test(prompt)
    || /cognitive delta that is not already visibly achieved/.test(prompt),
  "cognitive-delta rule must be present");
  assert.ok(/ordinary personal curiosity is never gossip/i.test(prompt)
    || /never gossip merely because a person is involved/.test(prompt),
  "gossip narrowing must be present");
  assert.ok(/one warm, vulnerable, or emotionally intense conversation does not establish/i.test(prompt)
    || /cannot acquire attachment solely within one uninterrupted conversation/i.test(prompt),
  "single-conversation attachment bar must be present");
  assert.ok(/the schema rejects amusement with weak strength/i.test(prompt),
    "weak-amusement rejection must be stated");
  assert.ok(/does not need to relate to the current event at all/i.test(prompt)
    || /need not relate to the current event at all/i.test(prompt),
  "culturalThought independence must be stated");
});

test("the prompts allow and encourage actual lore in soft power", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  assert.ok(/Лотара|Lothar/.test(prompt), "Lothar example must be present");
  assert.ok(/Артаса|Arthas/.test(prompt), "Arthas example must be present");
  assert.ok(/Утера|Uther/.test(prompt), "Uther example must be present");
  assert.ok(/easiest and most natural/.test(prompt), "lore-as-easy-move must be stated");
  assert.ok(/prefer the concrete story fragment over hiding it behind a generic abstraction/i.test(prompt),
    "concrete-lore preference must be stated");
});

test("no anti-lore suppression clauses remain", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  assert.ok(!prompt.includes("most such associations pass privately"),
    "private-association suppression must be gone");
  assert.ok(!prompt.includes("do not deliberately find a Warcraft fact to mention"),
    "deliberate-recall suppression must be gone");
  assert.ok(!prompt.includes("do not inject a Stormwind reference"),
    "decorate-suppression must be gone");
});

test("dull-topic lore soft-power fallback is expressible", () => {
  const decision: RealizerDecision = {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "я сьогодні чомусь думаю про людей, які йшли з Лотаром після падіння Штормвінда.",
    interpretation: "Bob talked about dinner; nothing about it activates a valid local motive.",
    presentMind: {
      immediate: "The dinner talk is mildly dull.",
      culturalThought: "I keep thinking about the part of Lothar's story where people fled Stormwind and had to decide what possessions to carry.",
      foreground: "The Lothar image is what is actually in the foreground now.",
    },
    characterIntent: "He is making small talk.",
    realityRelation: {
      kind: "difference",
      content: "Here talk drifts between strangers with no shared past, where at home a story like Lothar's belonged to everyone.",
    },
    dreamIntent: "The dream keeps supplying low-stakes topics to occupy attention.",
    feltState: "Quietly warmed by the memory.",
    activeDesire: {
      motive: "softPower",
      strength: "moderate",
      content: "I want Bob to have that image of refugees choosing which pieces of home to carry.",
      basis: "It is a real inherited story that matters to me, Bob does not yet have this image, and putting it into his mind directly serves my standing soft-power desire.",
    },
    desiredOutcome: "Bob now knows this fragment of the Lothar story and the human image that matters to me.",
    opportunity: "Bob is responsive and has not heard this story.",
    fiveTurnStrategy: "Tell the story fragment naturally, with no bridge to dinner.",
    fiftyTurnStrategy: "Let such remembered stories surface with this person whenever they genuinely arise.",
  };
  assert.equal(realizerDecisionSchema.safeParse(decision).success, true);
});

test("valid gossip requires a social-reputational object; food/mother curiosity is explicitly rejected", () => {
  const gossip: RealizerDecision = {
    ...baseDecision({
      motive: "gossip",
      strength: "moderate",
      content: "I want to know what Oleg actually did after accusing everyone else.",
      basis: "The object is a socially evaluative third-party event whose facts determine my judgment of his reputation.",
    }),
    action: "silence",
    addressCharacter: null,
    replyToMessage: null,
    message: null,
  };
  assert.equal(realizerDecisionSchema.safeParse(gossip).success, true);
  assert.equal(gossip.activeDesire.motive, "gossip");

  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  // The phrases may appear only as explicit prohibitions, not as valid objects.
  assert.ok(!prompt.includes("motive: gossip\ncontent: I want to know what Bob likes to eat"),
    "food-as-gossip must not be a valid example");
  assert.ok(/what Bob likes to eat|what food Bob likes/.test(prompt),
    "food-as-gossip rejection must be stated explicitly");
  assert.ok(/tell me more about yourself/.test(prompt),
    "generic personal curiosity rejection must be stated explicitly");
});
