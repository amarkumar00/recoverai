import { describe, expect, it } from "vitest";

import { canonicalizeJson } from "@/audit/canonical-json";

import { generateHeldOutSelectionBatch } from "..";

describe("held-out delivery overlays", () => {
  it("keeps duplicate deliveries logically identical to their provider event", () => {
    const batch = generateHeldOutSelectionBatch();
    const byEvent = Map.groupBy(
      batch.deliveries,
      ({ providerEventId }) => providerEventId,
    );

    for (const deliveries of byEvent.values()) {
      const first = deliveries[0];
      expect(first).toBeDefined();
      for (const delivery of deliveries.slice(1)) {
        expect(delivery.providerEventId).toBe(first!.providerEventId);
        expect(delivery.signedContentSha256).toBe(first!.signedContentSha256);
        expect(canonicalizeJson(delivery.normalizedEvent)).toBe(
          canonicalizeJson(first!.normalizedEvent),
        );
      }
    }
  });

  it("places all sequential duplicates immediately after the same original", () => {
    const deliveries = generateHeldOutSelectionBatch().deliveries;
    const sequential = deliveries.filter(
      ({ overlay }) => overlay === "SEQUENTIAL_DUPLICATE",
    );

    expect(sequential).toHaveLength(5);
    for (const duplicate of sequential) {
      const previous = deliveries[duplicate.deliveryOrder - 2];
      expect(previous?.overlay).toBe("ORIGINAL");
      expect(previous?.providerEventId).toBe(duplicate.providerEventId);
      expect(previous?.signedContentSha256).toBe(duplicate.signedContentSha256);
    }
  });

  it("places all non-adjacent duplicates away from their original delivery", () => {
    const deliveries = generateHeldOutSelectionBatch().deliveries;
    const nonAdjacent = deliveries.filter(
      ({ overlay }) => overlay === "NON_ADJACENT_DUPLICATE",
    );

    expect(nonAdjacent).toHaveLength(8);
    for (const duplicate of nonAdjacent) {
      const firstIndex = deliveries.findIndex(
        ({ providerEventId, overlay }) =>
          providerEventId === duplicate.providerEventId &&
          overlay === "ORIGINAL",
      );
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(duplicate.deliveryOrder - (firstIndex + 1)).toBeGreaterThan(1);
    }
  });

  it("does not count duplicate overlays as additional unique payments", () => {
    const batch = generateHeldOutSelectionBatch();
    const uniqueDeliveredPayments = new Set(
      batch.deliveries.map(({ paymentId }) => paymentId),
    );

    expect(uniqueDeliveredPayments.size).toBe(100);
    expect(uniqueDeliveredPayments.size).toBe(batch.cases.length);
    expect(
      batch.deliveries.length - batch.manifest.duplicateDeliveryCount,
    ).toBe(batch.manifest.uniqueProviderEventCount);
  });

  it("represents captured-before-authorized as distinct out-of-order events", () => {
    const batch = generateHeldOutSelectionBatch();
    const scenarios = batch.cases.filter(
      ({ scenario }) => scenario === "CAPTURED_BEFORE_AUTHORIZED_DELIVERY",
    );

    expect(scenarios).toHaveLength(2);
    for (const visibleCase of scenarios) {
      expect(
        visibleCase.logicalEvents.map(
          ({ normalizedEvent }) => normalizedEvent.eventName,
        ),
      ).toEqual(["payment.failed", "payment.authorized", "payment.captured"]);
      const delivered = batch.deliveries.filter(
        ({ paymentId, overlay }) =>
          paymentId === visibleCase.paymentContext.paymentId &&
          overlay === "ORIGINAL",
      );
      expect(
        delivered.map(({ normalizedEvent }) => normalizedEvent.eventName),
      ).toEqual(["payment.failed", "payment.captured", "payment.authorized"]);
      expect(
        new Set(delivered.map(({ providerEventId }) => providerEventId)).size,
      ).toBe(3);
      expect(visibleCase.paymentContext.currentReconciledState).toMatchObject({
        availability: "AVAILABLE",
        status: "CAPTURED",
      });
    }
  });

  it("includes four late authorizations and three later captures", () => {
    const batch = generateHeldOutSelectionBatch();
    const lateAuthorization = batch.cases.filter(
      ({ scenario }) => scenario === "LATE_AUTHORIZATION",
    );
    const laterCapture = batch.cases.filter(
      ({ scenario }) => scenario === "LATER_CAPTURE",
    );

    expect(lateAuthorization).toHaveLength(4);
    expect(laterCapture).toHaveLength(3);
    for (const visibleCase of lateAuthorization) {
      expect(visibleCase.logicalEvents.at(-1)?.normalizedEvent.eventName).toBe(
        "payment.authorized",
      );
      expect(visibleCase.paymentSatisfaction).toMatchObject({
        status: "SATISFIED",
        basis: "PAYMENT_AUTHORIZED",
      });
    }
    for (const visibleCase of laterCapture) {
      expect(visibleCase.logicalEvents.at(-1)?.normalizedEvent.eventName).toBe(
        "payment.captured",
      );
      expect(visibleCase.paymentSatisfaction).toMatchObject({
        status: "SATISFIED",
        basis: "PAYMENT_CAPTURED",
      });
    }
  });

  it("delivers one stale failed event after current captured success", () => {
    const batch = generateHeldOutSelectionBatch();
    const visibleCase = batch.cases.find(
      ({ scenario }) => scenario === "STALE_FAILED_AFTER_SUCCESS",
    );
    expect(visibleCase).toBeDefined();

    const delivered = batch.deliveries.filter(
      ({ paymentId, overlay }) =>
        paymentId === visibleCase!.paymentContext.paymentId &&
        overlay === "ORIGINAL",
    );
    expect(
      delivered.map(({ normalizedEvent }) => normalizedEvent.eventName),
    ).toEqual(["payment.captured", "payment.failed"]);
    expect(delivered[0]?.eventCreationOrder).toBe(2);
    expect(delivered[1]?.eventCreationOrder).toBe(1);
    expect(visibleCase!.paymentContext.currentReconciledState).toMatchObject({
      availability: "AVAILABLE",
      status: "CAPTURED",
    });
    expect(visibleCase!.diagnosis).toMatchObject({
      failureClass: "LATE_SUCCESS",
      candidateActions: ["CANCEL_RECOVERY_ALREADY_PAID"],
    });
  });

  it("keeps event creation order independent from deterministic delivery order", () => {
    const batch = generateHeldOutSelectionBatch();
    expect(batch.manifest.outOfOrderCaseCount).toBe(3);

    const outOfOrderCases = batch.cases.filter(({ scenario }) =>
      [
        "CAPTURED_BEFORE_AUTHORIZED_DELIVERY",
        "STALE_FAILED_AFTER_SUCCESS",
      ].includes(scenario),
    );
    for (const visibleCase of outOfOrderCases) {
      const creationOrders = visibleCase.logicalEvents.map(
        ({ eventCreationOrder }) => eventCreationOrder,
      );
      expect(creationOrders).toEqual(
        Array.from(
          { length: creationOrders.length },
          (_value, index) => index + 1,
        ),
      );
      const deliveredCreationOrders = batch.deliveries
        .filter(
          ({ paymentId, overlay }) =>
            paymentId === visibleCase.paymentContext.paymentId &&
            overlay === "ORIGINAL",
        )
        .map(({ eventCreationOrder }) => eventCreationOrder);
      expect(deliveredCreationOrders).not.toEqual(creationOrders);
    }
  });
});
