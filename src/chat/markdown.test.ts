import { markdownToBlocks } from './markdown';

it('splits blank-line separated paragraphs', () => {
  expect(markdownToBlocks('first para\n\nsecond para\n\n\nthird')).toEqual([
    { kind: 'paragraph', text: 'first para' },
    { kind: 'paragraph', text: 'second para' },
    { kind: 'paragraph', text: 'third' },
  ]);
});

it('keeps single newlines inside a paragraph', () => {
  expect(markdownToBlocks('line one\nline two')).toEqual([
    { kind: 'paragraph', text: 'line one\nline two' },
  ]);
});

it('extracts fenced code blocks, preserving blank lines inside the fence', () => {
  expect(markdownToBlocks('before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nafter')).toEqual([
    { kind: 'paragraph', text: 'before' },
    { kind: 'code', text: 'const a = 1;\n\nconst b = 2;' },
    { kind: 'paragraph', text: 'after' },
  ]);
});

it('normalizes CRLF', () => {
  expect(markdownToBlocks('a\r\n\r\nb')).toEqual([
    { kind: 'paragraph', text: 'a' },
    { kind: 'paragraph', text: 'b' },
  ]);
});

it('handles empty and whitespace-only input', () => {
  expect(markdownToBlocks('')).toEqual([]);
  expect(markdownToBlocks('  \n\n  ')).toEqual([]);
});

it('renders inline markdown literally (recorded plain-text fallback)', () => {
  expect(markdownToBlocks('has **bold** and _italics_')).toEqual([
    { kind: 'paragraph', text: 'has **bold** and _italics_' },
  ]);
});
