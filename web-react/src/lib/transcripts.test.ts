import { describe, expect, it } from 'vitest';
import { transcriptMessage, keepPolling } from './transcripts';

describe('transcriptMessage', () => {
  it('says what each state means, and nothing for a finished one', () => {
    expect(transcriptMessage({ status: 'pending' })).toBe('Transcribing…');
    expect(transcriptMessage({ status: 'empty' })).toBe('No speech found in this recording.');
    expect(transcriptMessage({ status: 'failed' })).toBe('Could not transcribe this recording.');
    expect(transcriptMessage({ status: 'off' })).toBe('Transcription is off. An admin can turn it on in Settings → Voice transcription.');
    expect(transcriptMessage({ status: 'none' })).toBe('This file has no transcript.');
    expect(transcriptMessage({ status: 'toolong' })).toBe('This recording is too long to transcribe.');
    expect(transcriptMessage({ status: 'done', text: 'hi' })).toBeNull();
  });
});

describe('keepPolling', () => {
  it('polls only while pending, for at most about two minutes', () => {
    expect(keepPolling({ status: 'pending' }, 0)).toBe(true);
    expect(keepPolling({ status: 'pending' }, 59)).toBe(true);
    expect(keepPolling({ status: 'pending' }, 60)).toBe(false);
    expect(keepPolling({ status: 'done', text: 'x' }, 1)).toBe(false);
  });
});
