import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { MAX_NATURAL_NAME_LENGTH, naturalNameSchema } from "../src/natural-names/schema.js";
import { createNaturalNameStore } from "../src/natural-names/store.js";

function tempPath(label: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), `hevronia-names-${label}-`)), "natural-names.sqlite");
}

test("first assignment persists and a second cannot overwrite it", async () => {
  const p = tempPath("first");
  const store = createNaturalNameStore(p);
  try {
    assert.equal(await store.assignIfAbsent(52, "Боб"), "Боб");
    assert.equal(await store.get(52), "Боб");
    assert.equal(await store.assignIfAbsent(52, "Роб"), "Боб");
    assert.equal(await store.get(52), "Боб");
  } finally {
    await store.close();
    rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("persistence survives closing and reopening the store", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hevronia-names-reopen-"));
  const p = path.join(dir, "natural-names.sqlite");
  let store = createNaturalNameStore(p);
  await store.assignIfAbsent(52, "Боб");
  await store.close();
  store = createNaturalNameStore(p);
  try {
    assert.equal(await store.get(52), "Боб");
    assert.equal(await store.assignIfAbsent(63, "Мес"), "Мес");
    assert.equal(await store.get(63), "Мес");
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two different Telegram ids may share the same natural name", async () => {
  const p = tempPath("same");
  const store = createNaturalNameStore(p);
  try {
    await store.assignIfAbsent(52, "Боб");
    await store.assignIfAbsent(94, "Боб");
    const names = await store.getMany([52, 94]);
    assert.deepEqual([...names.entries()], [[52, "Боб"], [94, "Боб"]]);
  } finally {
    await store.close();
    rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("getMany returns only stored names and an empty map for no ids", async () => {
  const p = tempPath("many");
  const store = createNaturalNameStore(p);
  try {
    await store.assignIfAbsent(52, "Боб");
    const names = await store.getMany([52, 63, 999]);
    assert.deepEqual([...names.entries()], [[52, "Боб"]]);
    assert.deepEqual([...(await store.getMany([])).entries()], []);
  } finally {
    await store.close();
    rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("temporary custom db paths are isolated from each other", async () => {
  const dirA = mkdtempSync(path.join(tmpdir(), "hevronia-names-iso-a-"));
  const dirB = mkdtempSync(path.join(tmpdir(), "hevronia-names-iso-b-"));
  const a = createNaturalNameStore(path.join(dirA, "natural-names.sqlite"));
  const b = createNaturalNameStore(path.join(dirB, "natural-names.sqlite"));
  try {
    await a.assignIfAbsent(52, "Боб");
    assert.equal(await a.get(52), "Боб");
    assert.equal(await b.get(52), undefined);
  } finally {
    await a.close();
    await b.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("competing concurrent assignments resolve to one stable persisted value", async () => {
  const p = tempPath("race");
  const store = createNaturalNameStore(p);
  try {
    const results = await Promise.all([
      store.assignIfAbsent(52, "Боб"),
      store.assignIfAbsent(52, "Роб"),
      store.assignIfAbsent(52, "Тім"),
    ]);
    const persisted = await store.get(52);
    assert.ok(persisted !== undefined);
    assert.equal(new Set(results).size, 1);
    assert.ok(results.every((value) => value === persisted));
  } finally {
    await store.close();
    rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("the central natural-name schema rejects empty, whitespace-only, and overlong names", () => {
  assert.equal(naturalNameSchema.safeParse("Боб").success, true);
  assert.equal(naturalNameSchema.safeParse("").success, false);
  assert.equal(naturalNameSchema.safeParse("   ").success, false);
  assert.equal(naturalNameSchema.safeParse("x".repeat(MAX_NATURAL_NAME_LENGTH)).success, true);
  assert.equal(naturalNameSchema.safeParse("x".repeat(MAX_NATURAL_NAME_LENGTH + 1)).success, false);
});
