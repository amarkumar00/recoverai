import { describe, expect, it } from "vitest";

import {
  canonicalJsonBytes,
  canonicalizeJson,
  NonCanonicalValueError,
} from "@/audit";

describe("canonical audit serialization", () => {
  it("sorts object keys lexicographically", () =>
    expect(canonicalizeJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}'));
  it("sorts nested object keys", () =>
    expect(canonicalizeJson({ x: { b: true, a: false } })).toBe(
      '{"x":{"a":false,"b":true}}',
    ));
  it("preserves array order", () =>
    expect(canonicalizeJson(["b", "a"])).toBe('["b","a"]'));
  it("represents null consistently", () =>
    expect(canonicalizeJson({ value: null })).toBe('{"value":null}'));
  it("encodes UTF-8 deterministically", () =>
    expect(Array.from(canonicalJsonBytes("₹"))).toEqual([
      34, 226, 130, 185, 34,
    ]));
  it("canonicalizes negative zero as zero", () =>
    expect(canonicalizeJson(-0)).toBe("0"));
  it("uses deterministic finite number syntax", () =>
    expect(canonicalizeJson(125000)).toBe("125000"));
  it("uses JSON escaping for strings", () =>
    expect(canonicalizeJson('a\n"b')).toBe('"a\\n\\"b"'));
  it("rejects undefined object values", () =>
    expect(() => canonicalizeJson({ value: undefined })).toThrow(
      NonCanonicalValueError,
    ));
  it("rejects undefined array values", () =>
    expect(() => canonicalizeJson([undefined])).toThrow(
      NonCanonicalValueError,
    ));
  it("rejects sparse arrays", () =>
    expect(() => canonicalizeJson(new Array(1))).toThrow(
      NonCanonicalValueError,
    ));
  it.each([NaN, Infinity, -Infinity])("rejects non-finite number %s", (value) =>
    expect(() => canonicalizeJson(value)).toThrow(NonCanonicalValueError),
  );
  it("rejects bigint", () =>
    expect(() => canonicalizeJson(BigInt(1))).toThrow(NonCanonicalValueError));
  it("rejects non-plain objects", () =>
    expect(() => canonicalizeJson(new Date(0))).toThrow(
      NonCanonicalValueError,
    ));
  it("produces identical output for canonical-identical input", () =>
    expect(canonicalizeJson({ b: [2, 1], a: null })).toBe(
      canonicalizeJson({ a: null, b: [2, 1] }),
    ));
  it("distinguishes array order", () =>
    expect(canonicalizeJson([1, 2])).not.toBe(canonicalizeJson([2, 1])));
});
