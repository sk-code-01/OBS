const REDACT_KEY = /(?:api[_-]?key|authorization|password|passwd|secret|token|cookie)/i;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;

export function sanitizeForTelemetry(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return {
      type: "Buffer",
      bytes: value.byteLength,
    };
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeForTelemetry(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[Truncated ${value.length - MAX_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Array.from(value.entries()).slice(0, MAX_OBJECT_KEYS)) {
      out[String(entryKey)] = REDACT_KEY.test(String(entryKey))
        ? "[REDACTED]"
        : sanitizeForTelemetry(entryValue, depth + 1, seen);
    }
    if (value.size > MAX_OBJECT_KEYS) {
      out._truncated = `${value.size - MAX_OBJECT_KEYS} more entries`;
    }
    return out;
  }

  if (value instanceof Set) {
    return sanitizeForTelemetry(Array.from(value.values()), depth + 1, seen);
  }

  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_OBJECT_KEYS);

  for (const [entryKey, entryValue] of entries) {
    out[entryKey] = REDACT_KEY.test(entryKey)
      ? "[REDACTED]"
      : sanitizeForTelemetry(entryValue, depth + 1, seen);
  }

  const totalKeys = Object.keys(value as Record<string, unknown>).length;
  if (totalKeys > MAX_OBJECT_KEYS) {
    out._truncated = `${totalKeys - MAX_OBJECT_KEYS} more keys`;
  }
  return out;
}
