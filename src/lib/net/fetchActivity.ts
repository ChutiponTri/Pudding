/**
 * How many data requests the page is waiting for, so the teacher UI can show a
 * "loading" signal while details are still being fetched (see FetchActivityBar).
 * Background polls that run on their own opt out, so the bar never blinks by itself.
 */
let inFlight = 0;
let quietDepth = 0;
const listeners = new Set<(count: number) => void>();

const emit = () => listeners.forEach((fn) => fn(inFlight));

/**
 * Runs `fn` with its requests left out of the loading signal: a background refresh of
 * data the page already shows (from the cache). Only requests started synchronously
 * inside `fn` count as quiet (dataService starts each request before its first await).
 */
export function quietly<T>(fn: () => T): T {
  quietDepth += 1;
  try {
    return fn();
  } finally {
    quietDepth -= 1;
  }
}

/** Marks one request as started; call the returned function once it is done (success or not). */
export function beginFetch(): () => void {
  if (quietDepth > 0) return () => {};
  inFlight += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight = Math.max(0, inFlight - 1);
    emit();
  };
}

export function subscribeFetchActivity(fn: (count: number) => void): () => void {
  listeners.add(fn);
  fn(inFlight);
  return () => {
    listeners.delete(fn);
  };
}
