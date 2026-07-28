/**
 * Markdown handling for reply/notice text — stage-4 recorded choice.
 *
 * DECISION: no markdown component library. The candidates
 * (react-native-markdown-display and friends) are unmaintained (no release
 * since 2021) and untested against React 19 / RN 0.86, which is exactly the
 * "heavy/unmaintained" case the stage spec resolves to the plain-text
 * fallback: render plain text with paragraph spacing. Recorded here and in
 * docs/ui-smoke/stage-4-chat.md.
 *
 * The one structural nicety kept: fenced code blocks (```) are split out so
 * the UI can render them monospaced instead of as a mangled paragraph. This
 * is a pure, testable splitter — not a markdown parser; all other markdown
 * syntax renders literally until a maintained renderer is adopted.
 */

export type MarkdownBlock = { kind: 'paragraph'; text: string } | { kind: 'code'; text: string };

/** Split markdown-ish text into paragraphs (blank-line separated) and fenced
 * code blocks. Never throws; empty input yields no blocks. */
export const markdownToBlocks = (text: string): MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  const normalized = text.replace(/\r\n/g, '\n');

  // Split out fenced code first; fences swallow blank lines inside them.
  const segments = normalized.split(/^```[^\n]*\n?/m);
  segments.forEach((segment, index) => {
    const insideFence = index % 2 === 1;
    if (insideFence) {
      const code = segment.replace(/\n$/, '');
      if (code.length > 0) blocks.push({ kind: 'code', text: code });
      return;
    }
    for (const paragraph of segment.split(/\n{2,}/)) {
      const trimmed = paragraph.trim();
      if (trimmed.length > 0) blocks.push({ kind: 'paragraph', text: trimmed });
    }
  });
  return blocks;
};
