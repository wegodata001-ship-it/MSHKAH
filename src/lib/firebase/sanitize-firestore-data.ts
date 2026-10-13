import { Timestamp } from "firebase/firestore";

function isNonFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && !Number.isFinite(value);
}

function isFirestoreSentinel(value: object): boolean {
  return "_methodName" in value || value instanceof Timestamp || value instanceof Date;
}

/** Firestore-native values that must pass through unchanged */
function isFirestoreLeaf(value: unknown): boolean {
  return (
    value === null ||
    typeof value !== "object" ||
    isFirestoreSentinel(value)
  );
}

/**
 * Recursively removes `undefined` and non-finite numbers from objects and arrays
 * before Firestore writes. Arrays drop those elements; nested objects omit the keys.
 * FieldValue / Timestamp sentinels are left intact.
 */
export function sanitizeFirestoreData<T>(data: T): T {
  if (data === undefined || isNonFiniteNumber(data)) {
    return undefined as T;
  }

  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined && !isNonFiniteNumber(item))
      .map((item) => sanitizeFirestoreData(item)) as T;
  }

  if (isFirestoreLeaf(data)) {
    return data;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || isNonFiniteNumber(value)) continue;
    const next = sanitizeFirestoreData(value);
    if (next === undefined) continue;
    result[key] = next;
  }
  return result as T;
}

/** Debug helper — lists dot-paths of undefined values in an object tree */
export function findUndefinedPaths(value: unknown, path = ""): string[] {
  if (value === undefined) {
    return path ? [path] : ["(root)"];
  }
  if (value === null || typeof value !== "object" || value instanceof Timestamp || value instanceof Date) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findUndefinedPaths(item, path ? `${path}[${i}]` : `[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) => {
    const next = path ? `${path}.${key}` : key;
    return findUndefinedPaths(v, next);
  });
}
