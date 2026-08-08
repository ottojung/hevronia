import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export const typescript = {
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
  plugins: {
    "@typescript-eslint": tsPlugin,
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
};
