import { describe, expect, it } from 'vitest';
import { isUnformattedHtml, looksLikeMarkdown, markdownToReplay } from './markdownPaste';

describe('isUnformattedHtml', () => {
  it('sees a code editor as plain text: colour is a style, not a heading', () => {
    // What VS Code puts on the clipboard — one span per token, colour only.
    const vscode =
      '<div style="color:#ccc;background:#1f1f1f"><div><span style="color:#569cd6">##</span> Title</div></div>';
    expect(isUnformattedHtml(vscode)).toBe(true);
  });

  it('sees a notes app / terminal copy as plain text', () => {
    expect(isUnformattedHtml('<div>## Title</div><div>- one</div>')).toBe(true);
    expect(isUnformattedHtml('<p>## Title<br>- one</p>')).toBe(true);
  });

  it('treats <pre> as a claim that the block is code, and leaves it alone', () => {
    // A YAML or diff sample copied out of a docs page is full of lines that
    // start "- ". Rewriting it into a bulleted list because of that would
    // throw away the one thing the source said out loud.
    expect(isUnformattedHtml('<pre><code>items:\n  - alpha\n  - beta\n</code></pre>')).toBe(false);
    expect(isUnformattedHtml('<pre>plain preformatted</pre>')).toBe(false);
  });

  it('leaves a real rich-text paste alone', () => {
    expect(isUnformattedHtml('<p>Some <strong>bold</strong> text</p>')).toBe(false);
    expect(isUnformattedHtml('<h1>Title</h1><p>Body</p>')).toBe(false);
    expect(isUnformattedHtml('<ul><li>one</li></ul>')).toBe(false);
    expect(isUnformattedHtml('<table><tr><td>a</td></tr></table>')).toBe(false);
    expect(isUnformattedHtml('<p><a href="/x">a link</a></p>')).toBe(false);
    expect(isUnformattedHtml('<img src="x.png">')).toBe(false);
  });

  it('does not mistake <br> or <blockquote> for <b>', () => {
    // `b` is in the list; the word boundary has to stop it matching a longer
    // tag name, or every line break would count as bold.
    expect(isUnformattedHtml('<div>one<br>two</div>')).toBe(true);
    expect(isUnformattedHtml('<blockquote>quoted</blockquote>')).toBe(false);
  });
});

describe('looksLikeMarkdown', () => {
  it.each([
    ['heading', '# Title'],
    ['deep heading', '###### Title'],
    ['bullet', 'intro\n- one\n- two'],
    ['star bullet', '* one'],
    ['numbered', '1. one\n2. two'],
    ['numbered with paren', '1) one'],
    ['quote', '> quoted'],
    ['fence', '```js\nconst x = 1;\n```'],
    ['table', '| a | b |\n| - | - |'],
    ['rule', 'above\n\n---\n\nbelow'],
    ['task', '- [ ] not done'],
    ['bold', 'a **bold** run'],
    ['underscore bold', 'a __bold__ run'],
    ['inline code', 'call `render()` first'],
    ['link', 'see [the docs](https://example.com)'],
    ['image', '![alt](pic.png)'],
  ])('reads %s as markdown', (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ['ordinary prose', 'We shipped the redirect map on Tuesday.'],
    ['a bare url', 'https://example.com/a/b'],
    ['a hyphen mid-sentence', 'a well-known problem - and its fix'],
    ['a number and a date', 'Q4 2026 revenue was 1.2m'],
    ['an empty string', ''],
  ])('leaves %s alone', (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });

  it('does not read a mid-line hyphen as a bullet', () => {
    // The bullet pattern is anchored: "a - b" is a sentence, "- b" is a list.
    expect(looksLikeMarkdown('one - two')).toBe(false);
    expect(looksLikeMarkdown('- two')).toBe(true);
  });
});

describe('markdownToReplay', () => {
  const dressed = '<div style="color:#ccc"><div>## Title</div><div>- one</div></div>';

  it('reroutes markdown that arrived wearing a code editor’s styling', () => {
    expect(markdownToReplay('## Title\n- one', dressed)).toBe('## Title\n- one');
  });

  it('leaves the paste alone when the HTML carries the formatting', () => {
    // The whole point of the html adapter: this one is already rich.
    expect(markdownToReplay('Title\none', '<h2>Title</h2><ul><li>one</li></ul>')).toBeNull();
  });

  it('leaves plain prose alone, so an ordinary paste is byte-for-byte unchanged', () => {
    expect(markdownToReplay('Just a sentence.', '<div>Just a sentence.</div>')).toBeNull();
  });

  it('does nothing when there is no HTML — that path already parses markdown', () => {
    // BlockSuite's text/plain adapter runs markdown through. Stepping in would
    // only replace a working path with an identical one.
    expect(markdownToReplay('# Title', '')).toBeNull();
  });

  it('does nothing for empty or whitespace-only text', () => {
    expect(markdownToReplay('', dressed)).toBeNull();
    expect(markdownToReplay('   \n  ', dressed)).toBeNull();
  });
});
