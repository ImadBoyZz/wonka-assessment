/* In-process mutex, keyed per run. The file-based run store has no
 * transactions, so every read-modify-write on a run must be serialized —
 * otherwise two concurrent decisions could both pass the 409 idempotency
 * check before either one persists (and the executor would run twice).
 * In production this becomes a database transaction / SELECT FOR UPDATE;
 * the single call-site-per-run contract stays identical. */

const chains = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}
