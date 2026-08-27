const required = [
  "RAZORPAY_TEST_KEY_ID",
  "RAZORPAY_TEST_KEY_SECRET",
  "RAZORPAY_TEST_PAYMENT_ID",
];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  process.stdout.write(
    `${JSON.stringify({ status: "SKIPPED", reason: "MISSING_OPTIONAL_TEST_MODE_CREDENTIALS", missing })}\n`,
  );
  process.exit(0);
}

const keyId = process.env.RAZORPAY_TEST_KEY_ID;
if (!keyId.startsWith("rzp_test_") || keyId.startsWith("rzp_live_")) {
  process.stderr.write(
    `${JSON.stringify({ status: "REJECTED", reason: "TEST_MODE_KEY_REQUIRED" })}\n`,
  );
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);
try {
  const paymentId = encodeURIComponent(process.env.RAZORPAY_TEST_PAYMENT_ID);
  const authorization = Buffer.from(
    `${keyId}:${process.env.RAZORPAY_TEST_KEY_SECRET}`,
    "utf8",
  ).toString("base64");
  const response = await fetch(
    `https://api.razorpay.com/v1/payments/${paymentId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    },
  );
  if (!response.ok) {
    process.stderr.write(
      `${JSON.stringify({ status: "FAILED_SAFE", reason: "TEST_MODE_READ_REJECTED", httpStatus: response.status })}\n`,
    );
    process.exitCode = 1;
  } else {
    const body = await response.json();
    if (body?.id !== process.env.RAZORPAY_TEST_PAYMENT_ID) {
      throw new Error("Test Mode returned an unexpected payment identity.");
    }
    process.stdout.write(
      `${JSON.stringify({ status: "PASS", mode: "Razorpay Test Mode", operation: "READ_ONLY_PAYMENT_FETCH", financialWrites: 0 })}\n`,
    );
  }
} catch {
  process.stderr.write(
    `${JSON.stringify({ status: "FAILED_SAFE", reason: "TEST_MODE_READ_UNAVAILABLE" })}\n`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
