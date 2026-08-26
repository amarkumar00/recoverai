import type { DigitalTwinSelectionBatch } from "./contracts";
import {
  generateDevelopmentMaterial,
  generateHeldOutMaterialForEvaluator,
} from "./internal-generator";

export function generateDevelopmentDataset(
  seed?: string,
): DigitalTwinSelectionBatch {
  return generateDevelopmentMaterial(seed);
}

export function generateHeldOutSelectionBatch(
  seed?: string,
): DigitalTwinSelectionBatch {
  return generateHeldOutMaterialForEvaluator(seed).selectionBatch;
}
