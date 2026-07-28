import { createSseParser, type SseEvent } from './sse-parser';

/** Feed a full stream in arbitrary chunk sizes and collect every event. */
const feedAll = (chunks: string[]): SseEvent[] => {
  const parser = createSseParser();
  return chunks.flatMap((chunk) => parser.feed(chunk));
};

/** Every way to split `text` into `parts` contiguous chunks is equivalent —
 * chunk boundaries must never change parse results. */
const everySplit = (text: string): string[][] => {
  const splits: string[][] = [];
  for (let i = 1; i < text.length; i += 1) {
    splits.push([text.slice(0, i), text.slice(i)]);
  }
  return splits;
};

describe('basic dispatch', () => {
  it('parses a single data event, defaulting the type to message', () => {
    expect(feedAll(['data: hello\n\n'])).toEqual([
      { event: 'message', data: 'hello', lastEventId: null },
    ]);
  });

  it('parses id, event, and data fields together', () => {
    expect(feedAll(['id: 7\nevent: reply\ndata: {"a":1}\n\n'])).toEqual([
      { event: 'reply', data: '{"a":1}', lastEventId: '7' },
    ]);
  });

  it('dispatches nothing until the blank line arrives', () => {
    const parser = createSseParser();
    expect(parser.feed('data: pending\n')).toEqual([]);
    expect(parser.feed('\n')).toEqual([{ event: 'message', data: 'pending', lastEventId: null }]);
  });

  it('a blank line with no data dispatches nothing', () => {
    expect(feedAll(['event: reply\n\n', ': ping\n\n'])).toEqual([]);
  });

  it('field with no colon is treated as a field name with empty value', () => {
    // Per spec, a line "data" (no colon) appends an EMPTY data line, so the
    // joined payload here is '\n' + 'x'.
    expect(feedAll(['data\ndata: x\n\n'])).toEqual([
      { event: 'message', data: '\nx', lastEventId: null },
    ]);
  });
});

describe('multi-line data', () => {
  it('joins consecutive data lines with newline', () => {
    expect(feedAll(['data: line1\ndata: line2\ndata: line3\n\n'])).toEqual([
      { event: 'message', data: 'line1\nline2\nline3', lastEventId: null },
    ]);
  });

  it('strips exactly one leading space from a value', () => {
    expect(feedAll(['data:  two spaces\ndata:none\n\n'])).toEqual([
      { event: 'message', data: ' two spaces\nnone', lastEventId: null },
    ]);
  });
});

describe('comments and unknown fields', () => {
  it('ignores comment lines (keep-alive pings)', () => {
    expect(feedAll([': keep-alive\ndata: x\n: another\n\n'])).toEqual([
      { event: 'message', data: 'x', lastEventId: null },
    ]);
  });

  it('ignores retry and unknown field names', () => {
    expect(feedAll(['retry: 10000\nfancy: field\ndata: x\n\n'])).toEqual([
      { event: 'message', data: 'x', lastEventId: null },
    ]);
  });
});

describe('line terminators', () => {
  it.each([
    ['LF', 'data: a\n\ndata: b\n\n'],
    ['CRLF', 'data: a\r\n\r\ndata: b\r\n\r\n'],
    ['CR', 'data: a\r\rdata: b\r\r'],
    ['mixed', 'data: a\r\n\ndata: b\n\r\n'],
  ])('handles %s terminators', (_name, stream) => {
    expect(feedAll([stream]).map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('does not mis-split a CRLF straddling a chunk boundary', () => {
    // "\r" ends chunk 1, "\n" begins chunk 2 — must be ONE terminator, not two
    // (two would dispatch a phantom event after the data line).
    const parser = createSseParser();
    expect(parser.feed('data: a\r')).toEqual([]);
    expect(parser.feed('\n')).toEqual([]);
    expect(parser.feed('\r\n')).toEqual([{ event: 'message', data: 'a', lastEventId: null }]);
  });
});

describe('chunk-boundary torture', () => {
  const stream =
    'id: 41\r\nevent: ack\r\ndata: {"m":1}\r\n\r\nid: 42\nevent: reply\ndata: x\ndata: y\n\n';
  const expected = [
    { event: 'ack', data: '{"m":1}', lastEventId: '41' },
    { event: 'reply', data: 'x\ny', lastEventId: '42' },
  ];

  it('parses the reference stream unsplit', () => {
    expect(feedAll([stream])).toEqual(expected);
  });

  it('parses identically for EVERY two-chunk split point', () => {
    for (const chunks of everySplit(stream)) {
      expect(feedAll(chunks)).toEqual(expected);
    }
  });

  it('parses identically fed one character at a time', () => {
    expect(feedAll(stream.split(''))).toEqual(expected);
  });
});

describe('last-event-id tracking', () => {
  it('persists across events that carry no id field', () => {
    const events = feedAll(['id: 5\ndata: a\n\n', 'data: b\n\n']);
    expect(events.map((e) => e.lastEventId)).toEqual(['5', '5']);
  });

  it('ignores an id containing NULL', () => {
    expect(
      feedAll(['id: 6\ndata: a\n\nid: bad\u0000id\ndata: b\n\n']).map((e) => e.lastEventId),
    ).toEqual(['6', '6']);
  });

  it('updates even when the id arrives on an otherwise empty event', () => {
    const parser = createSseParser();
    parser.feed('id: 9\n\n');
    expect(parser.lastEventId()).toBe('9');
  });
});

describe('BOM', () => {
  it('drops a single leading BOM', () => {
    expect(feedAll(['\uFEFFdata: x\n\n'])).toEqual([
      { event: 'message', data: 'x', lastEventId: null },
    ]);
  });
});
