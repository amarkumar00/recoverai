export class NonCanonicalValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonCanonicalValueError";
  }
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new NonCanonicalValueError(
        "Canonical JSON rejects non-finite numbers.",
      );
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value) || value[index] === undefined) {
        throw new NonCanonicalValueError(
          "Canonical JSON rejects sparse arrays and undefined values.",
        );
      }
      items.push(serialize(value[index]));
    }
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NonCanonicalValueError(
        "Canonical JSON accepts only plain objects.",
      );
    }
    const object = value as Record<string, unknown>;
    const members = Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined)
          throw new NonCanonicalValueError(
            "Canonical JSON rejects undefined values.",
          );
        return `${JSON.stringify(key)}:${serialize(object[key])}`;
      });
    return `{${members.join(",")}}`;
  }
  throw new NonCanonicalValueError(
    `Canonical JSON rejects ${typeof value} values.`,
  );
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(value));
}
