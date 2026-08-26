import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_ACTIONS } from "@/domain/actions";
import {
  normalizedPaymentEventSchema,
  razorpayStyleExternalWebhookEnvelopeSchema,
} from "@/domain/events";
import { canonicalTimestampSchema } from "@/domain/primitives";

import {
  DEFAULT_DEVELOPMENT_SEED,
  DEFAULT_HELD_OUT_SEED,
  DIGITAL_TWIN_DATASET_VERSION,
  DIGITAL_TWIN_DISTRIBUTION,
  developmentSeedSchema,
  digitalTwinSelectionBatchSchema,
  generateDevelopmentDataset,
  generateHeldOutSelectionBatch,
  heldOutSeedSchema,
  LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
  scorerVisibleDigitalTwinCaseSchema,
} from "..";
import {
  createHeldOutDigitalTwin,
  hiddenSimulatedOutcomeSchema,
} from "../evaluator-only";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("held-out Digital Twin invariants", () => {
  it("locks exactly 100 unique payments and the exact seven-category distribution", () => {
    const batch = generateHeldOutSelectionBatch();

    expect(batch.cases).toHaveLength(100);
    expect(batch.manifest.uniquePaymentCount).toBe(100);
    expect(
      new Set(batch.cases.map(({ paymentContext }) => paymentContext.paymentId))
        .size,
    ).toBe(100);
    expect(batch.manifest.distribution).toEqual(DIGITAL_TWIN_DISTRIBUTION);
    expect(
      Object.values(batch.manifest.distribution).reduce(
        (sum, count) => sum + count,
        0,
      ),
    ).toBe(100);
  });

  it("locks 125 deliveries, 112 unique events and 13 duplicate overlays", () => {
    const { manifest, deliveries } = generateHeldOutSelectionBatch();

    expect(deliveries).toHaveLength(125);
    expect(manifest).toMatchObject({
      uniqueProviderEventCount: 112,
      deliveryCount: 125,
      duplicateDeliveryCount: 13,
      sequentialDuplicateCount: 5,
      nonAdjacentDuplicateCount: 8,
    });
    expect(
      new Set(deliveries.map(({ providerEventId }) => providerEventId)).size,
    ).toBe(112);
  });

  it("reproduces deep-logically-identical held-out data and its manifest", () => {
    const first = generateHeldOutSelectionBatch(DEFAULT_HELD_OUT_SEED);
    const second = generateHeldOutSelectionBatch(DEFAULT_HELD_OUT_SEED);

    expect(second).toEqual(first);
    expect(second.manifest).toEqual(first.manifest);
    expect(first.manifest.fingerprintSha256).toBe(
      LOCKED_DEFAULT_HELD_OUT_FINGERPRINT_SHA256,
    );
  });

  it("changes generated content for another held-out seed without changing invariants", () => {
    const first = generateHeldOutSelectionBatch(DEFAULT_HELD_OUT_SEED);
    const second = generateHeldOutSelectionBatch(
      "recoverai-held-out:2026-v1-alternate",
    );

    expect(second.manifest.fingerprintSha256).not.toBe(
      first.manifest.fingerprintSha256,
    );
    expect(second.cases[0]?.caseId).not.toBe(first.cases[0]?.caseId);
    expect(second.cases).toHaveLength(100);
    expect(second.deliveries).toHaveLength(125);
    expect(second.manifest.distribution).toEqual(DIGITAL_TWIN_DISTRIBUTION);
  });

  it("uses stable identifiers, canonical timestamps and integer-subunit money", () => {
    const batch = generateHeldOutSelectionBatch();

    for (const visibleCase of batch.cases) {
      expect(visibleCase.caseId).toMatch(/^case_dt_[a-f0-9]{16}$/);
      expect(visibleCase.paymentContext.paymentId).toMatch(
        /^pay_dt_[a-f0-9]{16}$/,
      );
      expect(visibleCase.paymentContext.orderId).toMatch(
        /^order_dt_[a-f0-9]{16}$/,
      );
      expect(visibleCase.syntheticCustomerReference).toMatch(
        /^synthetic-non-production:[a-f0-9]{16}$/,
      );
      expect(
        canonicalTimestampSchema.safeParse(
          visibleCase.paymentContext.paymentCreatedAt,
        ).success,
      ).toBe(true);
      expect(
        Number.isSafeInteger(visibleCase.paymentContext.money.amountSubunits),
      ).toBe(true);
      expect(visibleCase.paymentContext.money.amountSubunits).toBeGreaterThan(
        0,
      );
      expect(visibleCase.paymentContext.money.currency).toBe("INR");
    }
  });

  it("validates every case, provider envelope and normalized event through strict boundaries", () => {
    const batch = generateHeldOutSelectionBatch();

    expect(digitalTwinSelectionBatchSchema.safeParse(batch).success).toBe(true);
    for (const visibleCase of batch.cases) {
      expect(
        scorerVisibleDigitalTwinCaseSchema.safeParse(visibleCase).success,
      ).toBe(true);
      for (const logicalEvent of visibleCase.logicalEvents) {
        expect(
          razorpayStyleExternalWebhookEnvelopeSchema.safeParse(
            logicalEvent.providerEnvelope,
          ).success,
        ).toBe(true);
        expect(
          normalizedPaymentEventSchema.safeParse(logicalEvent.normalizedEvent)
            .success,
        ).toBe(true);
      }
    }
  });

  it("creates evaluator-only simulated outcomes for exactly all six canonical actions", () => {
    const twin = createHeldOutDigitalTwin();
    const selectedAt = "2026-08-26T12:00:00.000Z";

    expect(twin.evaluator.caseCount).toBe(100);
    for (const visibleCase of twin.selectionBatch.cases) {
      const revealed = RECOVERY_ACTIONS.map((selectedAction) =>
        twin.evaluator.revealSelectedOutcome({
          caseId: visibleCase.caseId,
          selectedAction,
          selectedAt,
        }),
      );
      expect(revealed).toHaveLength(6);
      expect(
        new Set(revealed.map(({ selectedAction }) => selectedAction)),
      ).toEqual(new Set(RECOVERY_ACTIONS));
      for (const result of revealed) {
        expect(
          hiddenSimulatedOutcomeSchema.safeParse(result.outcome).success,
        ).toBe(true);
        expect(result.outcome.simulationLabel).toBe("SIMULATED");
      }
    }
  });

  it("rejects unknown recovery actions at the evaluator boundary", () => {
    const twin = createHeldOutDigitalTwin();
    const visibleCase = twin.selectionBatch.cases[0];
    expect(visibleCase).toBeDefined();

    expect(() =>
      twin.evaluator.revealSelectedOutcome({
        caseId: visibleCase!.caseId,
        selectedAction: "RETRY_ORIGINAL_PAYMENT" as never,
        selectedAt: "2026-08-26T12:00:00.000Z",
      }),
    ).toThrow();
  });

  it("keeps development and held-out namespaces, seeds and data boundaries separate", () => {
    const development = generateDevelopmentDataset();
    const heldOut = generateHeldOutSelectionBatch();

    expect(development.datasetKind).toBe("DEVELOPMENT");
    expect(development.boundary).toBe("DEVELOPMENT_SCORER_VISIBLE_SYNTHETIC");
    expect(development.cases).toHaveLength(28);
    expect(development.seed).toBe(DEFAULT_DEVELOPMENT_SEED);
    expect(heldOut.datasetKind).toBe("HELD_OUT");
    expect(heldOut.boundary).toBe("HELD_OUT_SCORER_VISIBLE_SYNTHETIC");
    expect(heldOut.seed).toBe(DEFAULT_HELD_OUT_SEED);
    expect(development.manifest.fingerprintSha256).not.toBe(
      heldOut.manifest.fingerprintSha256,
    );
    expect(
      new Set(development.cases.map(({ caseId }) => caseId)).intersection(
        new Set(heldOut.cases.map(({ caseId }) => caseId)),
      ).size,
    ).toBe(0);
    expect(developmentSeedSchema.safeParse(DEFAULT_HELD_OUT_SEED).success).toBe(
      false,
    );
    expect(heldOutSeedSchema.safeParse(DEFAULT_DEVELOPMENT_SEED).success).toBe(
      false,
    );
  });

  it("does not depend on ambient time, unseeded randomness, network or credentials", () => {
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("ambient time accessed");
    });
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("unseeded randomness accessed");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network accessed");
      }),
    );

    expect(() => generateHeldOutSelectionBatch()).not.toThrow();
    expect(Date.now).not.toHaveBeenCalled();
    expect(Math.random).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const generatorSource = readFileSync(
      resolve(process.cwd(), "src/digital-twin/internal-generator.ts"),
      "utf8",
    );
    expect(generatorSource).not.toMatch(/Date\.now\s*\(/);
    expect(generatorSource).not.toMatch(/Math\.random\s*\(/);
    expect(generatorSource).not.toMatch(/process\.env/);
    expect(generatorSource).not.toMatch(/\bfetch\s*\(/);
  });

  it("uses the locked dataset version and a fixed canonical generation time", () => {
    const batch = generateHeldOutSelectionBatch();

    expect(batch.datasetVersion).toBe(DIGITAL_TWIN_DATASET_VERSION);
    expect(batch.generatedAt).toBe("2026-08-26T00:00:00.000Z");
    expect(batch.manifest.generatedAt).toBe(batch.generatedAt);
  });
});
