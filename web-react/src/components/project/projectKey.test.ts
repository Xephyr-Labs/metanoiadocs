import { describe, expect, it } from 'vitest';
import { keyProblem } from './ProjectKeyDialog';

// The field refuses before the server does, so the refusals have to agree with
// it — server/src/task-key.js KEY_RE is the same shape.
describe('keyProblem', () => {
  it('passes the keys the server accepts', () => {
    for (const key of ['A', 'MD', 'PAY', 'MD2', 'ABCDEFGH']) {
      expect(keyProblem(key)).toBeNull();
    }
  });

  it('says what is wrong rather than that something is', () => {
    expect(keyProblem('')).toMatch(/empty/i);
    expect(keyProblem('ABCDEFGHI')).toMatch(/eight/i);
    expect(keyProblem('1ST')).toMatch(/starts with a letter/i);
    expect(keyProblem('MY KEY')).toMatch(/letters and digits/i);
    expect(keyProblem('MD-')).toMatch(/letters and digits/i);
  });
});
