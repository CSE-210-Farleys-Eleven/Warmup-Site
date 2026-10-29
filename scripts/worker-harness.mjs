// Run src/pipeline.worker.js in Node through its real message protocol, for tests and
// timing scripts. Only the browser FileReader transport is substituted: Node already
// has File and Blob, so parsing, limits and the model are the code the page runs.

/** @type {Promise<(type: string, payload?: object) => Promise<WorkerReply>> | undefined} */
let started;

/**
 * The worker's final reply to one request; progress messages are dropped.
 * @typedef {{id: number, result?: any, error?: string}} WorkerReply
 */

/**
 * Install the worker's globals and import it, once per process; later calls return the
 * same sender. A request the worker rejects resolves to a reply with `error`; the sender
 * never throws for that. Side effects: defines globalThis.self and globalThis.FileReader.
 * @returns {Promise<(type: string, payload?: object) => Promise<WorkerReply>>}
 * @example
 * const send = await startWorker();
 * (await send('page', {})).error  // => 'Load a dataset first.'
 */
export function startWorker() {
  started ??= (async () => {
    /** @type {Map<number, WorkerReply>} */
    const replies = new Map();
    globalThis.self = /** @type {any} */ ({ postMessage(message) {
      if ('result' in message || 'error' in message) replies.set(message.id, message);
    } });
    globalThis.FileReader = /** @type {any} */ (class {
      readAsText(blob) {
        blob.text().then(text => this.onload({ target: { result: text } }))
          .catch(e => { this.error = e; this.onerror?.(e); });
      }
    });
    await import('../src/pipeline.worker.js');
    let lastId = 0;
    return async (type, payload) => {
      const id = ++lastId;
      // The handler posts its final reply before its promise settles.
      await self.onmessage(/** @type {any} */ ({ data: { id, type, payload } }));
      const reply = replies.get(id);
      replies.delete(id);
      return reply;
    };
  })();
  return started;
}
