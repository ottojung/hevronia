import globals from "globals";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import importX from "eslint-plugin-import-x";
import hevroniaPlugin from "eslint-plugin-hevronia";

export const base = {
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
};
