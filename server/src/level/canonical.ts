import { keccak256, toBytes, type Hex } from "viem";

/**
 * Canonical JSON used for `layoutHash = keccak256(canonicalJSONBytes)` (SPEC §3.4).
 *
 * Rules (the web client MUST implement the same — see README "Canonical JSON"):
 *  - object keys sorted by UTF-16 code unit order (JS default sort), recursively
 *  - no insignificant whitespace
 *  - strings/numbers/booleans/null serialized exactly as JSON.stringify does
 *  - `undefined` object members are omitted; non-finite numbers are rejected
 *  - UTF-8 encoding of the resulting string
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("non-finite number in canonical JSON");
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`unsupported type in canonical JSON: ${typeof value}`);
  }
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export function layoutHash(value: unknown): Hex {
  return keccak256(toBytes(canonicalize(value)));
}
