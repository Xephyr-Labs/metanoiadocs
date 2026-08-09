import { describe, it, expect } from 'vitest';
import { stripFrontMatter, titleFromMarkdown } from './docFiles';

describe('stripFrontMatter', () => {
  it('drops a leading YAML block and the blank line after it', () => {
    const md = '---\ntitle: Notes\ntags: [a, b]\n---\n\n# Notes\n\nBody.';
    expect(stripFrontMatter(md)).toBe('# Notes\n\nBody.');
  });

  it('leaves a document that merely opens with a divider alone', () => {
    const md = '----\n\n# Notes';
    expect(stripFrontMatter(md)).toBe(md);
  });

  it('leaves an unterminated block alone rather than eating the document', () => {
    const md = '---\ntitle: Notes\n\n# Notes\n\nBody.';
    expect(stripFrontMatter(md)).toBe(md);
  });
});

describe('titleFromMarkdown', () => {
  it('prefers the first H1', () => {
    expect(titleFromMarkdown('## Sub\n\n# Real title\n\ntext', 'notes.md')).toBe('Real title');
  });

  it('falls back to the filename without its extension', () => {
    expect(titleFromMarkdown('no heading here', 'Meeting Notes.markdown')).toBe('Meeting Notes');
  });

  it('never returns an empty title', () => {
    expect(titleFromMarkdown('', '.md')).toBe('Untitled');
  });
});
