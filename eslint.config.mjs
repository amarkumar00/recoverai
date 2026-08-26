import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/repositories/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/*",
                "next",
                "next/*",
                "@/components/*",
                "@/app/*",
              ],
              message:
                "Persistence repositories must remain independent from UI and route modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/recovery/state-machine.ts",
      "src/recovery/transition-contracts.ts",
      "src/diagnosis/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react/*",
                "next",
                "next/*",
                "@/components/*",
                "@/app/*",
                "@/repositories/*",
              ],
              message:
                "Pure recovery and diagnosis logic must not depend on persistence, UI, or routes.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/ai/**/*.ts",
      "src/diagnosis/**/*.ts",
      "src/policy/**/*.ts",
      "src/recovery/**/*.ts",
    ],
    ignores: ["**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/digital-twin/evaluator-only",
                "@/digital-twin/internal-generator",
              ],
              message:
                "Action selection and execution cannot import evaluator-only Digital Twin outcomes.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "coverage/**", "data/**"]),
]);
