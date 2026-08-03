export function objectArrayToCsv(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows || rows.length === 0) return '';
  const cols = (() => {
    if (columns && columns.length > 0) return columns;
    const keySet = new Set<string>();
    rows.forEach(r => Object.keys(r).forEach(k => keySet.add(k)));
    return Array.from(keySet);
  })();

  const escapeCell = (val: any) => {
    if (val === undefined || val === null) return '';
    const s = String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const header = cols.join(',');
  const lines = rows.map(r => cols.map(c => escapeCell(r[c])).join(','));
  return [header, ...lines].join('\n');
}
