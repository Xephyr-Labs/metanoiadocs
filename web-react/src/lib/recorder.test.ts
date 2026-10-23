import { describe, expect, it } from 'vitest';
import { micErrorMessage, pickMime, voiceNoteName } from './recorder';

describe('pickMime', () => {
  it('prefers webm, falls back to mp4, else none', () => {
    expect(pickMime(() => true)).toBe('audio/webm');
    expect(pickMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => false)).toBe('');
  });
});

describe('voiceNoteName', () => {
  it('names a note by local time', () => {
    expect(voiceNoteName(new Date(2026, 9, 22, 14, 3), 'audio/webm')).toBe('Voice note 2026-10-22 14.03.webm');
    expect(voiceNoteName(new Date(2026, 9, 22, 9, 5), 'audio/mp4')).toBe('Voice note 2026-10-22 09.05.m4a');
  });
});

describe('micErrorMessage', () => {
  it('explains mic failures', () => {
    expect(micErrorMessage(new DOMException('', 'NotAllowedError'))).toBe("Microphone is blocked — allow it in the browser's site settings.");
    expect(micErrorMessage(new DOMException('', 'NotFoundError'))).toBe('No microphone found.');
    expect(micErrorMessage(new Error('x'))).toBe('Could not start recording.');
  });
});
