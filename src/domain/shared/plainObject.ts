/** Whether `key` is the object's own, never one it inherits. */
export const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key)

/**
 * Plain JSON objects only: no arrays, no class instances, no `Date`. So an entity cannot be
 * handed over where a row is expected.
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
