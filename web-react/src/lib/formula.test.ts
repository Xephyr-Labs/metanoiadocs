import { describe, expect, it } from 'vitest';
import { checkFormula, evaluate, type Scope, type Value } from './formula';

const scope = (props: Record<string, Value> = {}, today = '2026-09-15'): Scope => ({
  prop: (label) => props[label] ?? null,
  now: () => new Date(`${today}T00:00:00Z`),
});

const val = (src: string, props?: Record<string, Value>) => evaluate(src, scope(props)).value;

describe('arithmetic and properties', () => {
  it('reads a property by its label', () => {
    expect(val('prop("Points") * 2', { Points: 8 })).toBe(16);
  });

  it('treats an unset property as zero in arithmetic', () => {
    // A blank cell is not an error — it is a row nobody has filled in yet.
    expect(val('prop("Points") + 1')).toBe(1);
  });

  it('follows precedence rather than left-to-right', () => {
    expect(val('2 + 3 * 4')).toBe(14);
    expect(val('(2 + 3) * 4')).toBe(20);
  });

  it('refuses to divide by zero instead of returning Infinity', () => {
    expect(val('10 / 0')).toBe(null);
  });

  it('concatenates when either side is text, the way a spreadsheet does', () => {
    expect(val('"Q" + 4')).toBe('Q4');
    expect(val('1 + 4')).toBe(5);
  });
});

describe('logic', () => {
  it('picks a branch with if()', () => {
    expect(val('if(prop("Points") > 5, "big", "small")', { Points: 8 })).toBe('big');
    expect(val('if(prop("Points") > 5, "big", "small")', { Points: 2 })).toBe('small');
  });

  it('short-circuits, so a guard actually guards', () => {
    // The right side would divide by zero if it were evaluated anyway.
    expect(val('prop("N") != 0 and 10 / prop("N") > 1', { N: 0 })).toBe(false);
  });

  it('reads empty() as "nothing in this cell"', () => {
    expect(val('empty(prop("Due"))')).toBe(true);
    expect(val('empty(prop("Due"))', { Due: '2026-01-01' })).toBe(false);
    expect(val('empty(prop("N"))', { N: 0 })).toBe(true);
  });
});

describe('dates', () => {
  it('counts whole days between two dates', () => {
    expect(val('dateDiff(now(), prop("Due"))', { Due: '2026-09-20' })).toBe(5);
    expect(val('dateDiff(now(), prop("Due"))', { Due: '2026-09-10' })).toBe(-5);
  });

  it('adds days', () => {
    expect(val('dateAdd(prop("Start"), 7)', { Start: '2026-09-15' })).toBe('2026-09-22');
  });

  it('returns nothing rather than a wrong date when the cell is empty', () => {
    expect(val('dateDiff(now(), prop("Due"))')).toBe(null);
    expect(val('dateAdd(prop("Start"), 7)')).toBe(null);
  });
});

describe('bad formulas', () => {
  it('reports the fault instead of throwing at the table', () => {
    // Two hundred rows must not blank because one expression has a typo.
    const out = evaluate('prop("A" * 2', scope());
    expect(out.value).toBe(null);
    expect(out.error).toBeTruthy();
  });

  it('names an unknown function', () => {
    expect(evaluate('frobnicate(1)', scope()).error).toMatch(/no function/i);
  });

  it('insists prop() is given a quoted name', () => {
    expect(evaluate('prop(Points)', scope()).error).toBeTruthy();
  });

  it('refuses a bare identifier, which is the usual first mistake', () => {
    expect(evaluate('Points * 2', scope()).error).toMatch(/prop\("Name"\)/);
  });

  it('never reaches the host, whatever is typed at it', () => {
    // The parser only builds literal/prop/call/unary/bin nodes, so there is
    // nothing for these to hook into.
    for (const src of ['constructor', 'this', 'globalThis.alert(1)', '__proto__']) {
      expect(evaluate(src, scope()).error).toBeTruthy();
    }
  });

  it('rejects an expression long enough to be a denial of service', () => {
    expect(evaluate('1+'.repeat(2000) + '1', scope()).error).toMatch(/too long/i);
  });
});

describe('checkFormula', () => {
  it('says nothing about an empty box or a good formula', () => {
    expect(checkFormula('')).toBe(null);
    expect(checkFormula('prop("A") + 1')).toBe(null);
  });

  it('explains a broken one', () => {
    expect(checkFormula('prop("A" +')).toBeTruthy();
  });
});
