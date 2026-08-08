"use strict";

const { RuleTester } = require("eslint");
const rule = require("../rules/max-lines-per-file");

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

/**
 * Generates a JavaScript code string with the given number of unique code lines.
 * Each line declares a uniquely named variable so every line is a code token line.
 * @param {number} count
 * @returns {string}
 */
function makeCodeLines(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`const _v${i} = ${i};`);
  }
  return lines.join("\n");
}

/**
 * Generates a block of comment-only lines.
 * @param {number} count
 * @returns {string}
 */
function makeCommentLines(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`// comment line ${i}`);
  }
  return lines.join("\n");
}

tester.run("max-lines-per-file", rule, {
  valid: [
    // Exactly at the limit: 100 code lines → should pass
    { code: makeCodeLines(100) },

    // Under the limit
    { code: makeCodeLines(1) },
    { code: makeCodeLines(99) },

    // 400 lines of comments → should pass (comments are not counted)
    { code: makeCommentLines(400) },

    // 80 code lines + 200 comment lines → 80 code lines, should pass
    {
      code: makeCodeLines(80) + "\n" + makeCommentLines(200),
    },

    // 100 code lines + 500 comment lines → 100 code lines, exactly at limit, should pass
    {
      code: makeCodeLines(100) + "\n" + makeCommentLines(500),
    },
  ],

  invalid: [
    // 101 code lines → should fail
    {
      code: makeCodeLines(101),
      errors: [{ messageId: "tooManyLines" }],
    },

    // 400 code lines → should fail
    {
      code: makeCodeLines(400),
      errors: [{ messageId: "tooManyLines" }],
    },

    // 101 code lines + 1000 comment lines → still 101 code lines, should fail
    {
      code: makeCodeLines(101) + "\n" + makeCommentLines(1000),
      errors: [{ messageId: "tooManyLines" }],
    },
  ],
});

console.log("All max-lines-per-file tests passed!");
