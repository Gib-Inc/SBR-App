/**
 * attachPoolErrorHandler — make a node-postgres Pool survive a dropped connection.
 *
 * node-postgres emits an 'error' event on the Pool when an IDLE pooled client's
 * connection dies on its own: a Supabase/Railway idle-timeout, a server-side
 * reset, pg_terminate_backend, or a network blip. Per the pg docs, if NOTHING is
 * listening on that event, Node rethrows the error as an uncaughtException and
 * kills the whole process. That is the classic "the app ran fine for hours then
 * died, and kept dying on restart" production outage — the dropped connection has
 * nothing to do with whatever request happens to be in flight.
 *
 * Handling the event lets the Pool quietly discard the dead client and open a
 * fresh one on the next query, so a dropped connection becomes a logged blip
 * instead of a full crash. Call this on every Pool the app creates.
 *
 * Typed structurally (not against pg's Pool) so it stays decoupled from the pg
 * version and accepts every pool the codebase makes.
 */
export function attachPoolErrorHandler(
  pool: { on(event: "error", listener: (err: any) => void): unknown },
  label: string,
): void {
  pool.on("error", (err: any) => {
    console.error(
      `[Pool:${label}] idle client error (handled, process kept alive):`,
      err?.message ?? err,
    );
  });
}
