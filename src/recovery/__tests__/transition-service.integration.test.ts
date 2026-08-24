import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syntheticCustomerHash } from "@/domain/__tests__/fixtures";
import { createLocalDatabase } from "@/lib/db/client";
import { runDatabaseMigrations } from "@/lib/db/migrations";
import {
  recoveryCaseRecordSchema,
  recoveryCaseVersionUpdateSchema,
} from "@/repositories/contracts";
import type { RecoveryCaseRepository } from "@/repositories/interfaces";
import { createSqliteRepositories } from "@/repositories/sqlite";
import { transitionRecoveryCase } from "@/recovery/transition-service";
import { recoveryCaseTransitionCommandSchema } from "@/recovery/transition-contracts";

const transitionTime = "2026-08-25T10:00:00.000Z";
const temporaryDirectories: string[] = [];

function openMigratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "recoverai-transition-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "transition.db");
  const database = createLocalDatabase(path);
  runDatabaseMigrations(database);
  return { database, path };
}

function recoveryCase() {
  return recoveryCaseRecordSchema.parse({
    caseId: "case_transition_001",
    paymentId: "pay_transition_001",
    orderId: "order_transition_001",
    syntheticCustomerHash,
    verifiedUnpaidAmountSubunits: 125_000,
    currency: "INR",
    state: "DETECTED",
    attemptNumber: 1,
    previousSuccessCount: 0,
    previousFailureCount: 1,
    contactCount: 0,
    version: 1,
    createdAt: transitionTime,
    updatedAt: transitionTime,
  });
}

function command(overrides: Record<string, unknown> = {}) {
  return recoveryCaseTransitionCommandSchema.parse({
    caseId: "case_transition_001",
    expectedCurrentState: "DETECTED",
    requestedState: "VERIFYING",
    expectedVersion: 1,
    paymentSatisfaction: {
      status: "UNSATISFIED",
      paymentStatus: "FAILED",
      verifiedAt: transitionTime,
    },
    reasonCode: "BEGIN_VERIFICATION",
    reason: "Begin deterministic verification of the failed payment.",
    transitionedAt: transitionTime,
    ...overrides,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("recovery transition persistence service", () => {
  it("persists a legal transition and increments the version exactly once", () => {
    const { database } = openMigratedDatabase();
    const repository = createSqliteRepositories(database).recoveryCases;

    try {
      repository.create(recoveryCase());
      const result = transitionRecoveryCase(repository, command());
      expect(result).toMatchObject({
        status: "APPLIED",
        previousState: "DETECTED",
        resultingState: "VERIFYING",
        previousVersion: 1,
        resultingVersion: 2,
      });
      expect(repository.findById("case_transition_001")).toMatchObject({
        state: "VERIFYING",
        version: 2,
      });
    } finally {
      database.client.close();
    }
  });

  it("does not mutate storage for a rejected transition", () => {
    const { database } = openMigratedDatabase();
    const repository = createSqliteRepositories(database).recoveryCases;

    try {
      const original = repository.create(recoveryCase());
      const result = transitionRecoveryCase(
        repository,
        command({ requestedState: "LINK_CREATED" }),
      );
      expect(result.status).toBe("ILLEGAL_TRANSITION");
      expect(repository.findById("case_transition_001")).toEqual(original);
    } finally {
      database.client.close();
    }
  });

  it("does not mutate storage or increment version for a same-state no-op", () => {
    const { database } = openMigratedDatabase();
    const repository = createSqliteRepositories(database).recoveryCases;

    try {
      const original = repository.create(recoveryCase());
      const result = transitionRecoveryCase(
        repository,
        command({ requestedState: "DETECTED" }),
      );
      expect(result).toMatchObject({
        status: "IDEMPOTENT_NO_OP",
        resultingVersion: 1,
      });
      expect(repository.findById("case_transition_001")).toEqual(original);
    } finally {
      database.client.close();
    }
  });

  it("returns a typed not-found result", () => {
    const { database } = openMigratedDatabase();
    const repository = createSqliteRepositories(database).recoveryCases;

    try {
      expect(transitionRecoveryCase(repository, command())).toMatchObject({
        status: "CASE_NOT_FOUND",
        decisionReasonCode: "CASE_NOT_FOUND",
      });
    } finally {
      database.client.close();
    }
  });

  it("allows only one of two competing expected-version transitions to win", () => {
    const { database: firstDatabase, path } = openMigratedDatabase();
    const secondDatabase = createLocalDatabase(path);
    const firstRepository =
      createSqliteRepositories(firstDatabase).recoveryCases;
    const secondRepository =
      createSqliteRepositories(secondDatabase).recoveryCases;

    try {
      firstRepository.create(recoveryCase());
      const results = [
        transitionRecoveryCase(firstRepository, command()),
        transitionRecoveryCase(secondRepository, command()),
      ];
      expect(results.filter(({ status }) => status === "APPLIED")).toHaveLength(
        1,
      );
      expect(
        results.filter(({ status }) => status === "VERSION_CONFLICT"),
      ).toHaveLength(1);
      expect(firstRepository.findById("case_transition_001")).toMatchObject({
        state: "VERIFYING",
        version: 2,
      });
    } finally {
      secondDatabase.client.close();
      firstDatabase.client.close();
    }
  });

  it("returns a typed persistence conflict when another writer wins after validation", () => {
    const { database } = openMigratedDatabase();
    const baseRepository = createSqliteRepositories(database).recoveryCases;

    try {
      baseRepository.create(recoveryCase());
      const racingRepository: RecoveryCaseRepository = {
        ...baseRepository,
        updateIfVersionMatches(input) {
          baseRepository.updateIfVersionMatches(
            recoveryCaseVersionUpdateSchema.parse({
              caseId: input.caseId,
              expectedVersion: 1,
              state: "VERIFYING",
              updatedAt: transitionTime,
            }),
          );
          return baseRepository.updateIfVersionMatches(input);
        },
      };

      expect(transitionRecoveryCase(racingRepository, command())).toMatchObject(
        {
          status: "VERSION_CONFLICT",
          decisionReasonCode: "PERSISTENCE_VERSION_CONFLICT",
          resultingState: "VERIFYING",
          resultingVersion: 2,
        },
      );
    } finally {
      database.client.close();
    }
  });
});
