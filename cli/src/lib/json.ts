/** JSON.stringify with BigInt support, since chain reads return uint64 timestamps as BigInt. */
export function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}
