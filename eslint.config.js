import stylistic from "@stylistic/eslint-plugin";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from '@typescript-eslint/parser';
import path from "path";

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],

    // Flat config language options
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json",
        tsconfigRootDir: path.resolve(import.meta.dirname),
      }
    },

    plugins: {
      "@stylistic": stylistic,
      "@typescript-eslint": tseslint,
    },
    // Rules
    rules: {
      // ------------------------------
      // Stylistic rules
      // ------------------------------
      "@stylistic/indent": ["error", 2],
      "@stylistic/linebreak-style": ["warn", "unix"],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/array-bracket-spacing": ["error", "never"],
      "@stylistic/arrow-parens": ["error", "as-needed"],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],

      // ------------------------------
      // TypeScript rules
      // ------------------------------
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-function": "off",

      // ------------------------------
      // Async safety rules
      // ------------------------------
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false, ignoreIIFE: false },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: true, checksConditionals: true },
      ],
      "@typescript-eslint/return-await": ["error", "always"],
      "@typescript-eslint/require-await": "error",
    },

    // Ignore build outputs and JS files
    ignores: ["dist/", "node_modules/", "*.js", "*.cjs", "*.mjs"],
  },
];
