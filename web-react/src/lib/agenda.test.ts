import { describe, expect, it } from 'vitest';
import { agendaFor, monthDays } from './agenda';

const oct = monthDays(2026, 9);
const on = (agenda: ReturnType<typeof agendaFor>, day: string) =>
  agenda.find((d) => d.day === day)!.entries.map((e) => `${e.id}:${e.kind}:${e.dayOf}/${e.days}`);

describe('monthDays', () => {
  it('runs the 1st to the last day, leap years included', () => {
    expect(oct[0]).toBe('2026-10-01');
    expect(oct).toHaveLength(31);
    expect(monthDays(2028, 1).at(-1)).toBe('2028-02-29');
  });
});

describe('agendaFor', () => {
  it('lists every day of the month, empty ones included', () => {
    const a = agendaFor([], oct, '2026-10-07');
    expect(a).toHaveLength(31);
    expect(a.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('puts a one-day row on its day', () => {
    const a = agendaFor([{ id: 'a', from: '2026-10-08', to: '2026-10-08' }], oct, '2026-10-07');
    expect(on(a, '2026-10-08')).toEqual(['a:day:1/1']);
  });

  it('lists a span once where it starts, and again under today while it runs', () => {
    const a = agendaFor([{ id: 's', from: '2026-10-05', to: '2026-10-09' }], oct, '2026-10-07');
    expect(on(a, '2026-10-05')).toEqual(['s:span:1/5']);
    expect(on(a, '2026-10-07')).toEqual(['s:ongoing:3/5']);
    expect(a.flatMap((d) => d.entries)).toHaveLength(2);
  });

  it('does not repeat a span under today when today is its first day', () => {
    const a = agendaFor([{ id: 's', from: '2026-10-07', to: '2026-10-09' }], oct, '2026-10-07');
    expect(a.flatMap((d) => d.entries)).toHaveLength(1);
  });

  it('starts a span from an earlier month on the 1st, counting its real days', () => {
    const a = agendaFor([{ id: 's', from: '2026-09-22', to: '2026-10-10' }], oct, '2026-10-07');
    expect(on(a, '2026-10-01')).toEqual(['s:span:10/19']);
    expect(on(a, '2026-10-07')).toEqual(['s:ongoing:16/19']);
  });

  it('leaves out rows outside the month, and today outside it changes nothing', () => {
    const a = agendaFor(
      [
        { id: 'before', from: '2026-09-01', to: '2026-09-30' },
        { id: 'after', from: '2026-11-01', to: '2026-11-03' },
        { id: 'in', from: '2026-10-30', to: '2026-11-04' },
      ],
      oct,
      '2026-12-01',
    );
    expect(a.flatMap((d) => d.entries).map((e) => e.id)).toEqual(['in']);
  });

  it('keeps the order the rows came in', () => {
    const a = agendaFor(
      [
        { id: 'z', from: '2026-10-08', to: '2026-10-08' },
        { id: 'a', from: '2026-10-08', to: '2026-10-08' },
      ],
      oct,
      '2026-10-07',
    );
    expect(on(a, '2026-10-08')).toEqual(['z:day:1/1', 'a:day:1/1']);
  });
});
