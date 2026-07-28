import type { EventEnvelope } from 'agent-app-contract/types';
import {
  emptyTranscript,
  type TranscriptAction,
  type TranscriptState,
  transcriptItemKey,
  transcriptReducer,
} from './transcript';

const reduce = (actions: TranscriptAction[], from: TranscriptState = emptyTranscript) =>
  actions.reduce(transcriptReducer, from);

const envelope = (id: number, type: string, payload: Record<string, unknown>): EventEnvelope => ({
  schema: 1,
  id,
  type,
  at: '2026-07-27T00:00:00.000Z',
  payload,
});

const send = (messageId: string, text = 'hello'): TranscriptAction => ({
  type: 'send',
  messageId,
  text,
  at: '2026-07-27T00:00:00.000Z',
});

const ack = (id: number, messageId: string): TranscriptAction => ({
  type: 'event',
  envelope: envelope(id, 'ack', { messageId }),
});

const reply = (id: number, text: string): TranscriptAction => ({
  type: 'event',
  envelope: envelope(id, 'reply', { schema: 1, text, files: [] }),
});

describe('optimistic send lifecycle', () => {
  it('send inserts a sending item; 202 marks it accepted', () => {
    let state = reduce([send('m-1')]);
    expect(state.items).toMatchObject([{ kind: 'user', messageId: 'm-1', sendState: 'sending' }]);

    state = reduce([{ type: 'send-accepted', messageId: 'm-1' }], state);
    expect(state.items).toMatchObject([{ sendState: 'accepted' }]);
  });

  it('an ack event marks the matching messageId accepted', () => {
    const state = reduce([send('m-1'), ack(1, 'm-1')]);
    expect(state.items).toMatchObject([{ kind: 'user', sendState: 'accepted' }]);
  });

  it('a failed send flips to failed, but never un-accepts', () => {
    const failed = reduce([send('m-1'), { type: 'send-failed', messageId: 'm-1' }]);
    expect(failed.items).toMatchObject([{ sendState: 'failed' }]);

    const acceptedFirst = reduce([
      send('m-1'),
      { type: 'send-accepted', messageId: 'm-1' },
      { type: 'send-failed', messageId: 'm-1' },
    ]);
    expect(acceptedFirst.items).toMatchObject([{ sendState: 'accepted' }]);
  });

  it('retry re-sends with the SAME messageId: same item, same position, back to sending', () => {
    const state = reduce([
      send('m-1', 'first'),
      { type: 'send-failed', messageId: 'm-1' },
      reply(1, 'unrelated agent line'),
      send('m-1', 'first'), // retry — dedup key preserved
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({
      kind: 'user',
      messageId: 'm-1',
      text: 'first',
      sendState: 'sending',
    });
  });
});

describe('agent events', () => {
  it('reply and notice append agent items in arrival order', () => {
    const state = reduce([
      send('m-1'),
      ack(1, 'm-1'),
      reply(2, 'the reply'),
      {
        type: 'event',
        envelope: envelope(3, 'notice', { schema: 1, text: 'heads up', files: [] }),
      },
    ]);
    expect(state.items.map((i) => i.kind)).toEqual(['user', 'agent', 'agent']);
    expect(state.items[1]).toMatchObject({ eventType: 'reply', text: 'the reply', eventId: 2 });
    expect(state.items[2]).toMatchObject({ eventType: 'notice', text: 'heads up' });
  });

  it('unknown event types are ignored but still recorded as seen', () => {
    const state = reduce([{ type: 'event', envelope: envelope(9, 'stream-chunk', { t: 'x' }) }]);
    expect(state.items).toHaveLength(0);
    expect(state.seenEventIds.has(9)).toBe(true);
  });

  it('a reply with a malformed payload is dropped without corrupting the transcript', () => {
    const state = reduce([{ type: 'event', envelope: envelope(4, 'reply', { nope: true }) }]);
    expect(state.items).toHaveLength(0);
    expect(state.seenEventIds.has(4)).toBe(true);
  });
});

describe('dedup', () => {
  it('replayed event ids (resume overlap) do not duplicate agent items', () => {
    const state = reduce([reply(2, 'once'), reply(2, 'once'), reply(3, 'twice')]);
    expect(state.items).toHaveLength(2);
    expect(state.items.map((i) => (i.kind === 'agent' ? i.eventId : -1))).toEqual([2, 3]);
  });

  it('replayed acks are idempotent for the messageId', () => {
    const state = reduce([send('m-1'), ack(1, 'm-1'), ack(1, 'm-1'), ack(5, 'm-1')]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ sendState: 'accepted' });
  });

  it('an ack for an unknown messageId changes nothing but is recorded', () => {
    const state = reduce([ack(7, 'never-sent')]);
    expect(state.items).toHaveLength(0);
    expect(state.seenEventIds.has(7)).toBe(true);
  });
});

describe('reset', () => {
  it('switching connections empties the transcript', () => {
    const state = reduce([send('m-1'), reply(2, 'x'), { type: 'reset' }]);
    expect(state).toEqual(emptyTranscript);
  });
});

describe('list keys', () => {
  it('are unique across user and agent items', () => {
    const state = reduce([send('m-1'), ack(1, 'm-1'), reply(2, 'x')]);
    const keys = state.items.map(transcriptItemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
