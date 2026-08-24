import type { AiProviderInput } from "@/ai/contracts";

export type AiProviderOptions = {
  signal: AbortSignal;
};

export interface AiRecommendationProvider {
  estimate(
    input: AiProviderInput,
    options: AiProviderOptions,
  ): Promise<unknown>;
}
