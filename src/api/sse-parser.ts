/**
 * Incremental, spec-correct SSE parser (WHATWG "Server-sent events" §9.2.5-6).
 *
 * Pure module: feed it decoded text chunks (any split — mid-line, mid-CRLF,
 * mid-event) and it returns fully dispatched events. React Native has no
 * native EventSource, so the stream client (events.ts) drives this over a
 * streaming fetch body.
 *
 * Spec behaviors covered:
 * - Line terminators: CRLF, LF, and CR alone; a CRLF split across two chunks
 *   must not produce a phantom empty line (the trailing CR is held back).
 * - Comment lines (leading ':') are ignored — keep-alive pings arrive this way.
 * - `data:` accumulates across multiple lines, joined with '\n'.
 * - `event:` sets the event type for the next dispatch (default 'message').
 * - `id:` sets the stream's last-event-id, which PERSISTS across subsequent
 *   events (it is not reset per event); an id containing U+0000 is ignored.
 * - Unknown field names are ignored per spec ('retry' included — reconnect
 *   timing is our own backoff policy, not server-driven, in this client).
 * - A blank line dispatches; if the data buffer is empty, nothing is emitted.
 * - A leading U+FEFF BOM on the stream is dropped.
 */

export interface SseEvent {
  /** Event type — `event:` field value, or 'message' when absent. */
  event: string;
  /** Data payload — `data:` lines joined with '\n'. Never empty. */
  data: string;
  /** The stream's last-event-id as of this dispatch (sticky), null if unset. */
  lastEventId: string | null;
}

export interface SseParser {
  /** Feed a decoded text chunk; returns every event completed by it. */
  feed(chunk: string): SseEvent[];
  /** The sticky last-event-id seen so far (survives event boundaries). */
  lastEventId(): string | null;
}

export const createSseParser = (): SseParser => {
  let buffer = '';
  let bomChecked = false;
  /** Previous chunk ended in CR: an LF opening the next chunk completes that
   * CRLF and must be swallowed, not treated as a second terminator. */
  let skipLeadingLf = false;
  let dataLines: string[] = [];
  let eventType = '';
  let lastEventId: string | null = null;

  const processField = (field: string, value: string): void => {
    switch (field) {
      case 'data':
        dataLines.push(value);
        break;
      case 'event':
        eventType = value;
        break;
      case 'id':
        // An id containing NULL is ignored per spec; empty string is valid
        // and resets the id — but this contract's ids are integers, so the
        // stream client re-validates before using it as a cursor.
        if (!value.includes('\u0000')) lastEventId = value;
        break;
      default:
        // 'retry' and any unknown field: ignored.
        break;
    }
  };

  const processLine = (line: string, dispatched: SseEvent[]): void => {
    if (line === '') {
      // Blank line: dispatch if any data accumulated, then reset per-event
      // buffers. last-event-id deliberately survives.
      if (dataLines.length > 0) {
        dispatched.push({
          event: eventType === '' ? 'message' : eventType,
          data: dataLines.join('\n'),
          lastEventId,
        });
      }
      dataLines = [];
      eventType = '';
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive

    const colon = line.indexOf(':');
    if (colon === -1) {
      processField(line, '');
      return;
    }
    const field = line.slice(0, colon);
    let value = line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // strip ONE leading space
    processField(field, value);
  };

  return {
    feed(chunk: string): SseEvent[] {
      let text = chunk;
      if (!bomChecked && text.length > 0) {
        if (text.startsWith('\uFEFF')) text = text.slice(1);
        bomChecked = true;
      }
      if (skipLeadingLf) {
        if (text.startsWith('\n')) text = text.slice(1);
        skipLeadingLf = false;
      }
      buffer += text;

      const dispatched: SseEvent[] = [];
      let start = 0;
      for (let i = start; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (ch === '\n') {
          processLine(buffer.slice(start, i), dispatched);
          start = i + 1;
        } else if (ch === '\r') {
          // A CR terminates the line IMMEDIATELY (a lone CR is a valid
          // terminator and must not be held back waiting for more input);
          // if a CRLF straddles the chunk boundary, the LF arriving at the
          // head of the next chunk is swallowed via skipLeadingLf.
          processLine(buffer.slice(start, i), dispatched);
          if (i === buffer.length - 1) {
            skipLeadingLf = true;
            start = i + 1;
          } else {
            // CRLF within the buffer counts as a single terminator.
            start = buffer[i + 1] === '\n' ? i + 2 : i + 1;
            i = start - 1;
          }
        }
      }
      buffer = buffer.slice(start);
      return dispatched;
    },
    lastEventId: () => lastEventId,
  };
};
