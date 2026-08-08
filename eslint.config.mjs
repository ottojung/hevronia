/**
 * ESLint configuration for the project (flat config).
 */
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import hevroniaPlugin from "eslint-plugin-hevronia";

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Ignore patterns
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

  // ESLint recommended
  js.configs.recommended,

  // TypeScript recommended
  ...tsPlugin.configs["flat/recommended"],

  // Hevronia recommended
  {
    ...hevroniaPlugin.configs.recommended,
  },

  // Import plugin configs (before local rule block so local overrides take precedence)
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  // Base project config
  {
    name: "hevronia/base",
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: true,
        node: true,
      },
      "import-x/ignore": ["^virtual:"],
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "import-x": importX,
      hevronia: hevroniaPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "import-x/no-named-as-default-member": "off",
      "import-x/no-unresolved": [
        "error",
        {
          ignore: ["^virtual:"],
        },
      ],
      "no-warning-comments": [
        "error",
        {
          terms: [
            "eslint-disable",
            "eslint-disable-next-line",
            "eslint-disable-line",
            "eslint-enable",
          ],
          location: "anywhere",
        },
      ],
      "hevronia/no-deep-imports": [
        "error",
        {
          ignorePatterns: ["**/tests/**", "**/test/**", "scripts/**"],
        },
      ],
      "hevronia/no-non-toplevel-imports": [
        "error",
        {
          ignorePatterns: ["**/tests/**", "**/test/**", "scripts/**"],
        },
      ],
    },
  },

  // TypeScript source and tests with the TypeScript parser and project config
  {
    name: "hevronia/typescript",
    files: ["backend/src/**/*.ts", "backend/tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    rules: {
      "import-x/no-cycle": ["error", { maxDepth: "∞" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // Plain JavaScript (scripts, tooling): core no-unused-vars
  {
    name: "hevronia/javascript",
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: {
      "no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },

  // Test files override
  {
    name: "hevronia/tests",
    files: ["backend/tests/**/*.ts"],
    rules: {
      "hevronia/max-lines-per-file": "off",
    },
  },

  // Suppress import-x warnings on config and tooling files
  {
    name: "hevronia/config-files",
    files: ["eslint.config.mjs", "scripts/**", "tools/**"],
    rules: {
      "import-x/no-named-as-default": "off",
      "import-x/no-named-as-default-member": "off",
    },
  },
];
