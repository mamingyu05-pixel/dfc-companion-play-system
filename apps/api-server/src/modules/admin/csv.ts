// Excel opens UTF-8 CSV as Chinese text only with a BOM. Cells that start with = + - @ are prefixed
// with a quote so a nickname like "=HYPERLINK(...)" cannot run as a formula in the exported sheet.
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const cell = (value: string | number | null | undefined) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "﻿" + [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
