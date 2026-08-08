export const javascript = {
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
};

export const tests = {
  name: "hevronia/tests",
  files: ["backend/tests/**/*.ts"],
  rules: {
    "hevronia/max-lines-per-file": "off",
  },
};

export const eslintPluginSelf = {
  name: "hevronia/eslint-plugin-self",
  files: ["tools/eslint-plugin-hevronia/**"],
  rules: {
    "hevronia/max-lines-per-file": "off",
  },
};

export const configFiles = {
  name: "hevronia/config-files",
  files: ["eslint.config.mjs", "eslint/**", "scripts/**", "tools/**"],
  rules: {
    "import-x/no-named-as-default": "off",
    "import-x/no-named-as-default-member": "off",
  },
};
