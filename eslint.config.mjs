/**
 * ESLint configuration for the project (flat config).
 */
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importX from "eslint-plugin-import-x";
import hevroniaPlugin from "eslint-plugin-hevronia";

import { base } from "./eslint/base.mjs";
import { typescript } from "./eslint/typescript.mjs";
import { configFiles, eslintPluginSelf, javascript, tests } from "./eslint/javascript.mjs";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "docs/build/**",
      "docs/.docusaurus/**",
      "**/*.d.ts",
      ".data/**",
    ],
  },
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  { ...hevroniaPlugin.configs.recommended },
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  base,
  typescript,
  javascript,
  tests,
  eslintPluginSelf,
  configFiles,
];
