import type { PropOption, PropRow, PropType } from './tasksApi';

/** Ids a select/multi-select value holds, as an array either way. */
function ids(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

/** The options a value selects. An id whose option was deleted is dropped —
 *  the value stays in the database, so restoring the option restores the chip. */
export function selectedOptions(prop: PropRow, value: unknown): PropOption[] {
  const byId = new Map(prop.options.map((o) => [o.id, o]));
  return ids(value).map((id) => byId.get(id)).filter((o): o is PropOption => !!o);
}

/** One line of text for a table cell or a collapsed peek row. */
export function formatPropValue(
  prop: PropRow,
  value: unknown,
  users: { id: string; name: string }[] = [],
): string {
  if (value === null || value === undefined || value === '') {
    return prop.type === 'checkbox' ? 'No' : '';
  }
  switch (prop.type) {
    case 'checkbox':
      return value ? 'Yes' : 'No';
    case 'select':
    case 'multi_select':
      return selectedOptions(prop, value).map((o) => o.label).join(', ');
    case 'person':
      return users.find((u) => u.id === value)?.name ?? String(value);
    default:
      return String(value);
  }
}

/** What "not set" looks like per type, for a freshly rendered editor. */
export function emptyValue(type: PropType): unknown {
  if (type === 'checkbox') return false;
  if (type === 'multi_select') return [];
  return null;
}
