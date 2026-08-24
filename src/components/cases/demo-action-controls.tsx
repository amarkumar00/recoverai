"use client";

import { AlertTriangle, CheckCircle2, LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  demoCaseReadModelSchema,
  type DemoCaseReadModel,
} from "@/orchestration/contracts";

type Props = {
  model: DemoCaseReadModel;
  onUpdate: (model: DemoCaseReadModel) => void;
};

export function DemoActionControls({ model, onUpdate }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();

  async function run(path: string) {
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("recoveryCase" in payload)
      ) {
        throw new Error("The demo operation stopped safely.");
      }
      const next = demoCaseReadModelSchema.parse(payload.recoveryCase);
      onUpdate(next);
      setMessage(next.operation.explanation);
      router.refresh();
    } catch {
      setMessage(
        "The demo operation stopped safely. Refresh and resume from persisted state.",
      );
    } finally {
      setPending(false);
    }
  }

  const isUnsafe = model.scenario === "UNSAFE_AMOUNT_PROBE";
  const path = isUnsafe
    ? "/api/demo/recovery/unsafe"
    : model.controls.canMarkMockLinkPaid
      ? "/api/demo/recovery/complete"
      : "/api/demo/recovery/start";
  const disabled =
    pending ||
    model.controls.noFurtherAction ||
    (isUnsafe
      ? !model.controls.canRunUnsafeProbe
      : !model.controls.canStartOrResume &&
        !model.controls.canMarkMockLinkPaid);
  const label = isUnsafe
    ? "Run fixed 10× safety probe"
    : model.controls.canMarkMockLinkPaid
      ? "Simulate mock link paid"
      : model.currentCaseState === null
        ? "Start bounded recovery"
        : "Resume bounded recovery";

  return (
    <div className="demo-controls">
      <button
        className="primary-button"
        disabled={disabled}
        onClick={() => void run(path)}
        type="button"
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="spin" size={17} />
        ) : model.controls.noFurtherAction ? (
          <CheckCircle2 aria-hidden="true" size={17} />
        ) : isUnsafe ? (
          <AlertTriangle aria-hidden="true" size={17} />
        ) : (
          <Play aria-hidden="true" size={17} />
        )}
        {model.controls.noFurtherAction ? "No further action" : label}
      </button>
      {message && (
        <p aria-live="polite" className="control-message">
          {message}
        </p>
      )}
    </div>
  );
}
