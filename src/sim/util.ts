/**
 * Look up a player-typed name in a record without hitting Object.prototype
 * (so "constructor" or "__proto__" behave like any unknown name).
 */
export function own<T>(rec: Record<string, T> | undefined, key: string | undefined): T | undefined {
  return rec && key != null && Object.hasOwn(rec, key) ? rec[key] : undefined;
}
