import assert from "node:assert/strict";
import { test } from "node:test";

import { REALIZER_MODE } from "../src/realizer-prompt.js";
import { SYSTEM_PROMPT } from "../src/personality.js";
import {
  activeDesireSchema,
  interactionFrameSchema,
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
      culturalThought: { content: "ct", whyNow: "w" },
      foreground: "fg",
    },
    characterIntent: "c",
    interactionFrame: { kind: "open", stance: "accept", reason: "r" },
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
  const valid: ActiveDesire = { motive: "softPower", strength: "weak", content: "x", basis: "b", whyNow: "w" };
  const base = baseDecision(valid);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "none", strength: "weak", content: "x", basis: "b", whyNow: "w" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "softPower", strength: "none", content: "x", basis: "b", whyNow: "w" },
  }).success, false);
  assert.equal(realizerDecisionSchema.safeParse(base).success, true);
});

test("every decision field is required; there are no optional fields", () => {
  const full = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse(full).success, true);
  const allKeys = [
    "interpretation", "presentMind", "characterIntent", "interactionFrame", "realityRelation",
    "dreamIntent", "feltState", "activeDesire", "desiredOutcome", "opportunity",
    "fiveTurnStrategy", "fiftyTurnStrategy", "action", "message", "addressCharacter",
    "replyToMessage",
  ];
  for (const key of allKeys) {
    const partial: Record<string, unknown> = { ...full };
    delete partial[key];
    assert.equal(realizerDecisionSchema.safeParse(partial).success, false, `missing ${key}`);
  }
  assert.deepEqual(Object.keys(presentMindSchema.shape).sort(),
    ["culturalThought", "foreground", "immediate"]);
  assert.deepEqual(Object.keys(activeDesireSchema._def.schema.shape).sort(),
    ["basis", "content", "motive", "strength", "whyNow"]);
  assert.deepEqual(Object.keys(realityRelationSchema.shape).sort(), ["content", "kind"]);
  assert.deepEqual(Object.keys(interactionFrameSchema.shape).sort(), ["kind", "reason", "stance"]);
});

test("activeDesire.basis and whyNow are required and non-empty", () => {
  const base = baseDecision({ motive: "gossip", strength: "moderate", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", whyNow: "w" },
  }).success, false, "missing basis");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "b" },
  }).success, false, "missing whyNow");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base,
    activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "   ", whyNow: "w" },
  }).success, false, "blank basis");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base,
    activeDesire: { motive: "gossip", strength: "moderate", content: "x", basis: "b", whyNow: "   " },
  }).success, false, "blank whyNow");
});

test("presentMind fields are all required and non-empty; culturalThought carries content and whyNow", () => {
  const base = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b", whyNow: "w" });
  const shape = presentMindSchema.shape;
  assert.ok(!("stormwindAssociation" in shape), "stormwindAssociation must be removed");
  assert.ok(!("integration" in shape), "integration must be removed");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: { content: "ct", whyNow: "w" } },
  }).success, false, "missing foreground");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: { content: "   ", whyNow: "w" }, foreground: "fg" },
  }).success, false, "blank culturalThought.content");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: { content: "ct", whyNow: "   " }, foreground: "fg" },
  }).success, false, "blank culturalThought.whyNow");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, presentMind: { immediate: "im", culturalThought: { content: "ct", whyNow: "w" }, foreground: "fg" },
  }).success, true);
});

test("interactionFrame kind and stance are required enums", () => {
  assert.deepEqual(interactionFrameSchema.shape["kind"].options, ["open", "offered", "imposed"]);
  assert.deepEqual(interactionFrameSchema.shape["stance"].options, ["accept", "reshape", "reject"]);
  const base = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "none", stance: "accept", reason: "r" },
  }).success, false, "none kind invalid");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "imposed", stance: "accept" },
  }).success, false, "missing reason");
  assert.equal(realizerDecisionSchema.safeParse({
    ...base, interactionFrame: { kind: "imposed", stance: "reject", reason: "Technical-service role imposed on my attention." },
  }).success, true);
});

test("realityRelation kind is required and exactly difference | correspondence | distortion", () => {
  assert.deepEqual(realityRelationSchema.shape["kind"].options, ["difference", "correspondence", "distortion"]);
  const base = baseDecision({ motive: "softPower", strength: "weak", content: "x", basis: "b", whyNow: "w" });
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
  const weak = baseDecision({ motive: "amusement", strength: "weak", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse(weak).success, false, "weak amusement invalid");
  const moderate = baseDecision({ motive: "amusement", strength: "moderate", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse(moderate).success, true);
  const strong = baseDecision({ motive: "amusement", strength: "strong", content: "x", basis: "b", whyNow: "w" });
  assert.equal(realizerDecisionSchema.safeParse(strong).success, true);
});

test("execution fields remain required-nullable and speak requires a message", () => {
  const base = baseDecision({ motive: "amusement", strength: "moderate", content: "x", basis: "b", whyNow: "w" });
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

test("the prompts allow and encourage actual lore in soft power, but by salience not inventory", () => {
  const prompt = SYSTEM_PROMPT + REALIZER_MODE;
  assert.ok(/Лотара|Lothar/.test(prompt), "Lothar material must be present");
  assert.ok(/Артаса|Arthas/.test(prompt), "Arthas material must be present");
  assert.ok(/Утера|Uther/.test(prompt), "Uther material must be present");
  assert.ok(/easiest and most natural/.test(prompt), "lore-as-easy-move must be stated");
  assert.ok(/associative salience, not inventory novelty/.test(prompt)
    || /follows associative salience/.test(prompt),
  "lore selection by salience must be stated");
  assert.ok(/the fact that there exists another untold story is never itself a new soft-power desire/.test(prompt),
    "untold-story-is-not-a-desire must be stated");
  assert.ok(/repeated immediate paraphrase has diminishing value/.test(prompt)
    || /diminishing value/.test(prompt),
  "saturation must be stated");
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

test("the realizer prompt no longer carries a canonical reusable lore reply or a named lore inventory", () => {
  const prompt = REALIZER_MODE;
  assert.ok(!prompt.includes("я в дитинстві дуже любила історії про Утера"),
    "canonical Uther reply must be removed from the realizer");
  assert.ok(!prompt.includes("Alonsus Faol") && !prompt.includes("Alonsus Faol"),
    "operational named-lore inventory must not enumerate figures in the realizer");
  assert.ok(!prompt.includes("the preferred ordinary fallback is soft power"),
    "automatic lore-to-current-target fallback must be removed");
  assert.ok(!prompt.includes("a story from home needs no bridge to the greeting"),
    "universal no-bridge rule must be removed");
  assert.ok(!prompt.includes("a sharp redirect needs no transition"),
    "universal free-redirect rule must be removed");
  assert.ok(/frame-rejection redirection|imposed frame/i.test(prompt),
    "frame-rejection vs free-redirection distinction must be present");
  assert.ok(/a fresh cognitive delta is necessary but not sufficient/.test(prompt)
    || /necessary but not sufficient/.test(prompt),
  "delta-not-sufficient rule must be present");
});

test("dull-topic lore soft-power move is expressible only with real pull", () => {
  const decision: RealizerDecision = {
    action: "speak",
    addressCharacter: "P1",
    replyToMessage: null,
    message: "я сьогодні чомусь думаю про людей, які йшли з Лотаром після падіння Штормвінда.",
    interpretation: "Bob talked about dinner; nothing about it activates a valid local motive, but the frame is open.",
    presentMind: {
      immediate: "The dinner talk is mildly dull.",
      culturalThought: {
        content: "The image of people fleeing Stormwind with Lothar and deciding what possessions to carry.",
        whyNow: "Homesickness from earlier turns has kept the image of people carrying pieces of home active.",
      },
      foreground: "The Lothar image is what is actually in the foreground now.",
    },
    characterIntent: "He is making small talk.",
    interactionFrame: {
      kind: "open",
      stance: "accept",
      reason: "A harmless social opening that infringes nothing.",
    },
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
      whyNow: "The image has stayed emotionally foregrounded through recent turns, and I now genuinely want another mind to carry it.",
    },
    desiredOutcome: "Bob now knows this fragment of the Lothar story and the human image that matters to me.",
    opportunity: "Bob is responsive and has not heard this story.",
    fiveTurnStrategy: "Tell the story fragment naturally, since it has real pull, with no bridge to dinner.",
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
      whyNow: "His accusation leaves the underlying incident unresolved and I want the facts to judge it.",
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
