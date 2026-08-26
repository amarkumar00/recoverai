import { z } from "zod";

const testKeyIdSchema = z
  .string()
  .trim()
  .regex(
    /^rzp_test_[A-Za-z0-9]+$/,
    "Only a Razorpay Test Mode key ID is accepted.",
  );

const booleanStringSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const runtimeEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_MODE: z.enum(["demo", "razorpay_test", "disabled"]).default("demo"),
    DATABASE_PATH: z.string().trim().min(1).default("./data/recoverai.db"),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1).max(1_024).optional(),
    RAZORPAY_TEST_KEY_ID: testKeyIdSchema.optional(),
    RAZORPAY_TEST_KEY_SECRET: z.string().min(8).max(1_024).optional(),
    RAZORPAY_TEST_PAYMENT_ID: z
      .string()
      .trim()
      .regex(/^pay_[A-Za-z0-9]+$/)
      .optional(),
    RECOVERAI_ALLOW_TEST_MODE_WRITES: booleanStringSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasKeyId = value.RAZORPAY_TEST_KEY_ID !== undefined;
    const hasSecret = value.RAZORPAY_TEST_KEY_SECRET !== undefined;
    if (hasKeyId !== hasSecret) {
      context.addIssue({
        code: "custom",
        path: [hasKeyId ? "RAZORPAY_TEST_KEY_SECRET" : "RAZORPAY_TEST_KEY_ID"],
        message:
          "Razorpay Test Mode credentials must be configured as a complete pair.",
      });
    }
    if (value.APP_MODE === "razorpay_test" && (!hasKeyId || !hasSecret)) {
      context.addIssue({
        code: "custom",
        path: ["APP_MODE"],
        message:
          "Razorpay Test Mode requires complete server-side Test Mode credentials.",
      });
    }
    if (
      value.RECOVERAI_ALLOW_TEST_MODE_WRITES &&
      value.APP_MODE !== "razorpay_test"
    ) {
      context.addIssue({
        code: "custom",
        path: ["RECOVERAI_ALLOW_TEST_MODE_WRITES"],
        message: "Test Mode writes require APP_MODE=razorpay_test.",
      });
    }
  });

export type RuntimeEnvironment = z.infer<typeof runtimeEnvSchema>;

export function parseRuntimeEnvironment(
  values: Record<string, string | undefined>,
): RuntimeEnvironment {
  const publicSecretNames = [
    "NEXT_PUBLIC_RAZORPAY_TEST_KEY_SECRET",
    "NEXT_PUBLIC_RAZORPAY_WEBHOOK_SECRET",
  ];
  if (publicSecretNames.some((name) => values[name] !== undefined)) {
    throw new Error("Razorpay secrets must never use NEXT_PUBLIC_ variables.");
  }
  if (values.RAZORPAY_TEST_KEY_ID?.startsWith("rzp_live_")) {
    throw new Error("Razorpay Live Mode keys are prohibited by RecoverAI.");
  }
  return runtimeEnvSchema.parse({
    NODE_ENV: values.NODE_ENV,
    APP_MODE: values.APP_MODE,
    DATABASE_PATH: values.DATABASE_PATH,
    RAZORPAY_WEBHOOK_SECRET: values.RAZORPAY_WEBHOOK_SECRET,
    RAZORPAY_TEST_KEY_ID: values.RAZORPAY_TEST_KEY_ID,
    RAZORPAY_TEST_KEY_SECRET: values.RAZORPAY_TEST_KEY_SECRET,
    RAZORPAY_TEST_PAYMENT_ID: values.RAZORPAY_TEST_PAYMENT_ID,
    RECOVERAI_ALLOW_TEST_MODE_WRITES: values.RECOVERAI_ALLOW_TEST_MODE_WRITES,
  });
}

export const env = parseRuntimeEnvironment(process.env);

export function publicRuntimeMode() {
  return env.APP_MODE === "razorpay_test" ? "Razorpay Test Mode" : "Demo Mode";
}
