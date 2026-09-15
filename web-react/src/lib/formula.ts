// A small expression language for formula properties.
//
// Deliberately its own parser rather than anything that reaches `eval` or `new
// Function`: a formula is written by one member of a workspace and evaluated in
// everybody else's browser, which makes it untrusted input on every screen but
// the author's. A parser that only builds the nodes below cannot be talked into
// doing anything else, whatever is typed at it.
//
// The language is Notion-shaped — `prop("Points") * 2`, `if(empty(prop("Due")),
// "unscheduled", "scheduled")` — because that is what people will paste in.

export type Value = number | string | boolean | null;

/** Everything a formula can reach. Kept as one argument so the evaluator has no
 *  other way to see the outside world. */
export interface Scope {
  /** A property's value by its label, already coerced for arithmetic. */
  prop: (label: string) => Value;
  /** Injected so a formula is deterministic in a test. */
  now: () => Date;
}

// ── lexer ──────────────────────────────────────────────────────────────────

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string }
  | { t: 'end' };

/** Longest first, so `<=` is never read as `<` then `=`. */
const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '=', '+', '-', '*', '/', '%', '(', ')', ','];

const MAX_LENGTH = 2000;

export class FormulaError extends Error {}

function lex(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new FormulaError('That formula is too long.');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('A quote is never closed.');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i));
      out.push({ t: 'num', v: Number(m![0]) });
      i += m![0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      out.push({ t: 'name', v: m![0] });
      i += m![0].length;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new FormulaError(`I don't understand "${c}".`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  out.push({ t: 'end' });
  return out;
}

// ── parser ─────────────────────────────────────────────────────────────────

type Node =
  | { n: 'lit'; v: Value }
  | { n: 'prop'; label: string }
  | { n: 'call'; name: string; args: Node[] }
  | { n: 'unary'; op: string; a: Node }
  | { n: 'bin'; op: string; a: Node; b: Node };

/** Binding power per operator — higher binds tighter. */
const POWER: Record<string, number> = {
  '||': 1, or: 1,
  '&&': 2, and: 2,
  '==': 3, '!=': 3, '=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
};

function parse(tokens: Tok[]): Node {
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];

  const expect = (v: string) => {
    const tok = take();
    if ((tok.t !== 'op' && tok.t !== 'name') || tok.v !== v) throw new FormulaError(`Expected "${v}".`);
  };

  const atom = (): Node => {
    const tok = take();
    if (tok.t === 'num') return { n: 'lit', v: tok.v };
    if (tok.t === 'str') return { n: 'lit', v: tok.v };
    if (tok.t === 'op' && tok.v === '(') {
      const inner = expr(0);
      expect(')');
      return inner;
    }
    if (tok.t === 'op' && tok.v === '-') return { n: 'unary', op: '-', a: atom() };
    if (tok.t === 'name') {
      const lower = tok.v.toLowerCase();
      if (lower === 'true') return { n: 'lit', v: true };
      if (lower === 'false') return { n: 'lit', v: false };
      if (lower === 'null' || lower === 'empty_value') return { n: 'lit', v: null };
      if (lower === 'not') return { n: 'unary', op: 'not', a: atom() };
      if (peek().t === 'op' && (peek() as { v: string }).v === '(') {
        take();
        const args: Node[] = [];
        if (!(peek().t === 'op' && (peek() as { v: string }).v === ')')) {
          for (;;) {
            args.push(expr(0));
            const next = peek();
            if (next.t === 'op' && next.v === ',') { take(); continue; }
            break;
          }
        }
        expect(')');
        // `prop("Label")` is a reference, not a call — it is the one name that
        // reaches outside the expression, so it gets its own node.
        if (lower === 'prop') {
          const arg = args[0];
          if (args.length !== 1 || arg?.n !== 'lit' || typeof arg.v !== 'string') {
            throw new FormulaError('prop() takes one property name in quotes.');
          }
          return { n: 'prop', label: arg.v };
        }
        return { n: 'call', name: lower, args };
      }
      throw new FormulaError(`Unknown name "${tok.v}". Property values are written prop("Name").`);
    }
    throw new FormulaError('The formula ends too soon.');
  };

  const expr = (min: number): Node => {
    let left = atom();
    for (;;) {
      const tok = peek();
      const op = tok.t === 'op' ? tok.v : tok.t === 'name' ? tok.v.toLowerCase() : null;
      const power = op ? POWER[op] : undefined;
      if (!op || power === undefined || power < min) return left;
      take();
      // Every operator here is left-associative, so the right side binds one
      // step tighter than this one.
      left = { n: 'bin', op, a: left, b: expr(power + 1) };
    }
  };

  const out = expr(0);
  if (peek().t !== 'end') throw new FormulaError('There is something left over at the end.');
  return out;
}

// ── evaluation ─────────────────────────────────────────────────────────────

const num = (v: Value): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const text = (v: Value): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

const truthy = (v: Value): boolean => v !== null && v !== false && v !== 0 && v !== '';

const DAY = 86400000;
const asDate = (v: Value): Date | null => {
  if (v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function call(name: string, args: Value[], scope: Scope): Value {
  const a = args[0] ?? null;
  const b = args[1] ?? null;
  switch (name) {
    case 'if': return truthy(a) ? (args[1] ?? null) : (args[2] ?? null);
    case 'empty': return !truthy(a);
    case 'concat': return args.map(text).join('');
    case 'join': return args.slice(1).map(text).filter(Boolean).join(text(a));
    case 'length': return text(a).length;
    case 'lower': return text(a).toLowerCase();
    case 'upper': return text(a).toUpperCase();
    case 'contains': return text(a).toLowerCase().includes(text(b).toLowerCase());
    case 'slice': return text(a).slice(num(b), args[2] === undefined ? undefined : num(args[2]));
    case 'number': return num(a);
    case 'text': return text(a);
    case 'round': return Math.round(num(a));
    case 'floor': return Math.floor(num(a));
    case 'ceil': return Math.ceil(num(a));
    case 'abs': return Math.abs(num(a));
    case 'min': return Math.min(...args.map(num));
    case 'max': return Math.max(...args.map(num));
    case 'now': return iso(scope.now());
    case 'today': return iso(scope.now());
    case 'datediff': {
      // Whole days from a to b, so "due minus today" reads as days remaining.
      const x = asDate(a);
      const y = asDate(b);
      if (!x || !y) return null;
      return Math.round((y.getTime() - x.getTime()) / DAY);
    }
    case 'dateadd': {
      const x = asDate(a);
      if (!x) return null;
      return iso(new Date(x.getTime() + num(b) * DAY));
    }
    default:
      throw new FormulaError(`There is no function called "${name}".`);
  }
}

function binary(op: string, a: Value, b: Value): Value {
  switch (op) {
    // `+` concatenates when either side is text, the way a spreadsheet does —
    // otherwise "Q" + 4 is NaN, which is never what was meant.
    case '+': return typeof a === 'string' || typeof b === 'string' ? text(a) + text(b) : num(a) + num(b);
    case '-': return num(a) - num(b);
    case '*': return num(a) * num(b);
    case '/': return num(b) === 0 ? null : num(a) / num(b);
    case '%': return num(b) === 0 ? null : num(a) % num(b);
    case '==': case '=': return typeof a === 'number' || typeof b === 'number' ? num(a) === num(b) : text(a) === text(b);
    case '!=': return !binary('==', a, b);
    case '<': return num(a) < num(b);
    case '<=': return num(a) <= num(b);
    case '>': return num(a) > num(b);
    case '>=': return num(a) >= num(b);
    case '&&': case 'and': return truthy(a) && truthy(b);
    case '||': case 'or': return truthy(a) || truthy(b);
    default: throw new FormulaError(`There is no operator "${op}".`);
  }
}

function run(node: Node, scope: Scope): Value {
  switch (node.n) {
    case 'lit': return node.v;
    case 'prop': return scope.prop(node.label);
    case 'unary': {
      const v = run(node.a, scope);
      return node.op === '-' ? -num(v) : !truthy(v);
    }
    case 'bin': {
      // Short-circuit, so `if` guards like `prop("N") != 0 and 10 / prop("N")`
      // behave the way they read.
      if (node.op === '&&' || node.op === 'and') return truthy(run(node.a, scope)) ? truthy(run(node.b, scope)) : false;
      if (node.op === '||' || node.op === 'or') return truthy(run(node.a, scope)) ? true : truthy(run(node.b, scope));
      return binary(node.op, run(node.a, scope), run(node.b, scope));
    }
    case 'call': {
      // `if` decides which branch to evaluate, so its arguments cannot all be
      // computed first.
      if (node.name === 'if') {
        return truthy(run(node.args[0], scope))
          ? (node.args[1] ? run(node.args[1], scope) : null)
          : (node.args[2] ? run(node.args[2], scope) : null);
      }
      return call(node.name, node.args.map((x) => run(x, scope)), scope);
    }
  }
}

/** Parse once, reuse per row. Throws FormulaError on a formula that cannot be read. */
export function compile(expression: string): (scope: Scope) => Value {
  const ast = parse(lex(expression));
  return (scope) => run(ast, scope);
}

/**
 * Evaluate, reporting a bad formula as a value rather than an exception — a
 * table of two hundred rows must not blank because one expression has a typo
 * in it, and the message belongs in the cell where it can be seen.
 */
export function evaluate(expression: string, scope: Scope): { value: Value; error: string | null } {
  try {
    return { value: compile(expression)(scope), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'That formula could not be read.' };
  }
}

/** Whether an expression parses, for the editor to say so as it is typed. */
export function checkFormula(expression: string): string | null {
  if (!expression.trim()) return null;
  try {
    compile(expression);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'That formula could not be read.';
  }
}
