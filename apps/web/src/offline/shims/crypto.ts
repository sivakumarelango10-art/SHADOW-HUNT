/** Browser stand-in for the `node:crypto` calls the server simulation makes (artifact build only). */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
export function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! % max;
}
export default { randomUUID, randomInt };
