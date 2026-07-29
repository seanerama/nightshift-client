/** Unit: what long-press-copy puts on the clipboard (stage 12). */

import { copyTextForItem, isCopyable } from './copy';
import type { TranscriptItem } from './transcript';

const userItem = (text: string): TranscriptItem => ({
  kind: 'user',
  messageId: 'm1',
  text,
  sendState: 'accepted',
  at: '2026-07-28T00:00:00.000Z',
});

const agentItem = (text: string): TranscriptItem => ({
  kind: 'agent',
  eventId: 1,
  eventType: 'reply',
  text,
  files: [],
  at: '2026-07-28T00:00:00.000Z',
});

describe('copyTextForItem', () => {
  it('copies a user message verbatim', () => {
    expect(copyTextForItem(userItem('deploy the thing'))).toBe('deploy the thing');
  });

  it('copies the agent’s RAW markdown, not the rendered blocks', () => {
    // Someone copying a reply wants what was said, fences included; the
    // markdown splitter is presentation.
    const raw = 'Run this:\n\n```sh\nnpm test\n```\n\nthen check CI.';
    expect(copyTextForItem(agentItem(raw))).toBe(raw);
  });
});

describe('isCopyable', () => {
  it('is true for real content', () => {
    expect(isCopyable(agentItem('something'))).toBe(true);
  });

  it.each(['', '   ', '\n\t '])('is false for whitespace-only text (%j)', (text) => {
    // The affordance stays inert rather than silently clearing the clipboard.
    expect(isCopyable(userItem(text))).toBe(false);
  });
});
