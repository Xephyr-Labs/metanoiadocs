import { describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  it('uses the async Clipboard API when the browser has one', async () => {
    const writeAsync = vi.fn().mockResolvedValue(undefined);
    const writeLegacy = vi.fn().mockReturnValue(true);
    expect(await copyText('hello', { writeAsync, writeLegacy })).toBe(true);
    expect(writeAsync).toHaveBeenCalledWith('hello');
    expect(writeLegacy).not.toHaveBeenCalled();
  });

  it('falls back when there is no Clipboard API — the insecure-origin case', async () => {
    const writeLegacy = vi.fn().mockReturnValue(true);
    expect(await copyText('hello', { writeLegacy })).toBe(true);
    expect(writeLegacy).toHaveBeenCalledWith('hello');
  });

  it('falls back when the API exists but refuses', async () => {
    const writeAsync = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeLegacy = vi.fn().mockReturnValue(true);
    expect(await copyText('hello', { writeAsync, writeLegacy })).toBe(true);
    expect(writeLegacy).toHaveBeenCalledWith('hello');
  });

  it('reports failure only when both paths fail — never a false success', async () => {
    const writeAsync = vi.fn().mockRejectedValue(new Error('nope'));
    const writeLegacy = vi.fn().mockReturnValue(false);
    expect(await copyText('hello', { writeAsync, writeLegacy })).toBe(false);
  });

  it('reports failure when the browser offers no way to copy at all', async () => {
    expect(await copyText('hello', {})).toBe(false);
  });
});
