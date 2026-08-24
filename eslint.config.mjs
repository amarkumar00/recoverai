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
  globalIgnores([".next/**", "coverage/**", "data/**"]),
]);
