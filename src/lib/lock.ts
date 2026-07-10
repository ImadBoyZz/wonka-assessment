/* In-process mutex, keyed per run. The file-based run store has no
 * transactions, so read-modify-write on a run is serialized here. Without it,
 * two concurrent decisions could both pass the 409 check before either one
 * persists, and the executor would run twice. In production this would be a
 * database transaction (SELECT FOR UPDATE). */

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
