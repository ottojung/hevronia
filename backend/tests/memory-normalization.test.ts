import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeRecalledMemory } from "../src/long-term-memory/memory-normalization.js";
import { renderParticipantMemoryContexts } from "../src/long-term-memory/render-context.js";

test("normalizeRecalledMemory strips leading subject references to the scoped character", () => {
  assert.equal(
    normalizeRecalledMemory("User's favourite colour is purple."),
    "Favourite colour is purple.",
  );
  assert.equal(
    normalizeRecalledMemory("The user's favourite colour is purple."),
    "Favourite colour is purple.",
  );
  assert.equal(normalizeRecalledMemory("User likes sheep."), "Likes sheep.");
  assert.equal(normalizeRecalledMemory("The user likes sheep."), "Likes sheep.");
  assert.equal(
    normalizeRecalledMemory("User wants to visit Victoria."),
    "Wants to visit Victoria.",
  );
  assert.equal(normalizeRecalledMemory("user's cat is named Tom."), "Cat is named Tom.");
});

test("normalizeRecalledMemory leaves non-subject occurrences of the word user intact", () => {
  assert.equal(
    normalizeRecalledMemory("Uses the phrase \"power user\" jokingly."),
    "Uses the phrase \"power user\" jokingly.",
  );
  assert.equal(
    normalizeRecalledMemory("Users often discuss software."),
    "Users often discuss software.",
  );
  assert.equal(
    normalizeRecalledMemory("Favourite colour is purple."),
    "Favourite colour is purple.",
  );
  assert.equal(normalizeRecalledMemory(""), "");
});

test("model-facing memory context normalizes legacy user-labelled facts", () => {
  const rendered = renderParticipantMemoryContexts([
    { participant: { kind: "user", id: 42 }, memories: [
      { text: "User's favourite colour is purple." },
      { text: "The user likes sheep." },
      { text: "User wants a dog." },
      { text: "Uses the phrase \"power user\" jokingly." },
    ] },
  ]);
  assert.match(rendered, /character 42/);
  assert.match(rendered, /Favourite colour is purple\./);
  assert.match(rendered, /Likes sheep\./);
  assert.match(rendered, /Wants a dog\./);
  assert.match(rendered, /power user/);
  assert.doesNotMatch(rendered, /User's/);
  assert.doesNotMatch(rendered, /The user/);
  assert.doesNotMatch(rendered, /User wants/);
  assert.doesNotMatch(rendered, /user 42/);
  assert.doesNotMatch(rendered, /participant/);
  assert.doesNotMatch(rendered, /spreadsheet/);
});
