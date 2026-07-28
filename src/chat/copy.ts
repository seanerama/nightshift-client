/**
 * What "copy this message" copies (stage 12).
 *
 * Pure, so the decision is testable without a clipboard or a device: the
 * component only performs the write.
 *
 * Agent text is copied VERBATIM — the raw markdown the agent sent, not the
 * rendered blocks. Someone copying a message wants what was said, including
 * fenced code, and the markdown splitter is a presentation concern.
 */

import type { TranscriptItem } from './transcript';

export const copyTextForItem = (item: TranscriptItem): string => item.text;

/** Nothing useful to put on the clipboard — the affordance stays inert. */
export const isCopyable = (item: TranscriptItem): boolean =>
  copyTextForItem(item).trim().length > 0;
