import { createZipBytes, type ZipEntry } from '@/lib/storage/zip';

/**
 * Minimal .xlsx writer (no dependency): several sheets of plain values, a bold
 * frozen header row, auto filter and rough column widths. Opens in Excel,
 * Google Sheets, LibreOffice and pandas (`pd.read_excel(path, sheet_name=None)`).
 * Strings are written inline, numbers as numbers, booleans as TRUE/FALSE.
 * Works in the browser and on the server.
 */

export type Cell = string | number | boolean | null | undefined;

/** Background colours a body cell may get. */
export type CellFill = 'violet' | 'sky' | 'rose' | 'amber' | 'slate';
const FILLS: Record<CellFill, string> = { violet: 'FFEDE9FE', sky: 'FFE0F2FE', rose: 'FFFFE4E6', amber: 'FFFEF3C7', slate: 'FFF1F5F9' };
const FILL_ORDER = Object.keys(FILLS) as CellFill[];

/** A body cell's colour and/or comment (a note shown on hover in Excel / Google Sheets). */
export interface CellMark {
  fill?: CellFill;
  comment?: string;
}

export interface Sheet {
  /** Sheet tab name (cleaned and made unique, max 31 characters). */
  name: string;
  /** First row; written bold and frozen. */
  header: string[];
  rows: Cell[][];
  /** Column widths in characters; guessed from the content when missing. */
  widths?: number[];
  /** Body cells to colour or comment, keyed by markKey(rowIndex, columnIndex) (0-based within `rows`). */
  marks?: Record<string, CellMark>;
}

export const markKey = (row: number, column: number) => `${row}:${column}`;

/** Rows of objects → a sheet (columns from `columns`, or every key seen). Nested values become JSON. */
export function sheetFromObjects(name: string, rows: Array<Record<string, unknown>>, columns?: string[]): Sheet {
  const header = columns || [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    name,
    header,
    rows: rows.map((row) =>
      header.map((key) => {
        const value = row[key];
        if (value === null || value === undefined) return null;
        if (typeof value === 'object') return JSON.stringify(value);
        return value as Cell;
      })
    ),
  };
}

const xmlEscape = (text: string) =>
  text
    // Characters XML 1.0 does not allow (Excel refuses the file otherwise).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → A, 25 → Z, 26 → AA … */
function columnName(index: number) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel caps a cell at 32767 characters. */
const MAX_CELL = 32767;

function cellXml(value: Cell, ref: string, style = 0) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return style ? `<c r="${ref}"${s}/>` : '';
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : '';
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value).slice(0, MAX_CELL);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/** Cell style index: 0 plain, 1 header, 2… one per fill. */
const fillStyle = (fill?: CellFill) => (fill ? 2 + FILL_ORDER.indexOf(fill) : 0);

const commentsOf = (sheet: Sheet) =>
  Object.entries(sheet.marks || {})
    .filter(([, m]) => m.comment)
    .map(([key, m]) => {
      const [row, column] = key.split(':').map(Number);
      return { row, column, text: m.comment! };
    });

function commentsXml(sheet: Sheet) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Pudding</author></authors><commentList>' +
    commentsOf(sheet)
      .map((c) => `<comment ref="${columnName(c.column)}${c.row + 2}" authorId="0"><text><r><t xml:space="preserve">${xmlEscape(c.text.slice(0, MAX_CELL))}</t></r></text></comment>`)
      .join('') +
    '</commentList></comments>'
  );
}

/** Excel shows comments only with these legacy VML shapes (one per comment, hidden until hover). */
function vmlXml(sheet: Sheet, sheetIndex: number) {
  const shapes = commentsOf(sheet)
    .map((c, i) => {
      const r = c.row + 1; // 0-based sheet row (the header is row 0)
      const lines = Math.min(12, c.text.split('\n').length + 1);
      return (
        `<v:shape id="_x0000_s${(sheetIndex + 1) * 1024 + i + 1}" type="#_x0000_t202" style="position:absolute;margin-left:60pt;margin-top:2pt;width:220pt;height:${lines * 14}pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
        '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
        '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
        `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${c.column + 1}, 15, ${r}, 2, ${c.column + 4}, 15, ${r + lines}, 4</x:Anchor>` +
        `<x:AutoFill>False</x:AutoFill><x:Row>${r}</x:Row><x:Column>${c.column}</x:Column></x:ClientData></v:shape>`
      );
    })
    .join('');
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${sheetIndex + 1}"/></o:shapelayout>` +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    shapes +
    '</xml>'
  );
}

function sheetXml(sheet: Sheet) {
  const columnCount = Math.max(sheet.header.length, ...sheet.rows.map((r) => r.length), 1);
  const widths = Array.from({ length: columnCount }, (_, i) => {
    if (sheet.widths?.[i]) return sheet.widths[i];
    // Thai and other wide text reads fine at ~1 unit per character.
    const sample = [sheet.header[i], ...sheet.rows.slice(0, 200).map((r) => r[i])];
    const longest = Math.max(...sample.map((v) => (v === null || v === undefined ? 0 : String(v).length)));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const header = `<row r="1">${sheet.header.map((h, i) => cellXml(h, `${columnName(i)}1`, 1)).join('')}</row>`;
  const body = sheet.rows
    .map((row, r) => `<row r="${r + 2}">${row.map((v, i) => cellXml(v, `${columnName(i)}${r + 2}`, fillStyle(sheet.marks?.[markKey(r, i)]?.fill))).join('')}</row>`)
    .join('');
  const lastRef = `${columnName(columnCount - 1)}${sheet.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    cols +
    `<sheetData>${header}${body}</sheetData>` +
    (sheet.header.length ? `<autoFilter ref="A1:${lastRef}"/>` : '') +
    (commentsOf(sheet).length ? '<legacyDrawing r:id="rId2"/>' : '') +
    '</worksheet>'
  );
}

/** Sheet names: no []:*?/\, unique, 1–31 characters. */
function sheetNames(sheets: Sheet[]) {
  const used = new Set<string>();
  return sheets.map((sheet, i) => {
    const base = (sheet.name.replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)}~${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The workbook's bytes. */
export function createXlsx(sheets: Sheet[]): Uint8Array {
  const list = sheets.length ? sheets : [{ name: 'Sheet1', header: [], rows: [] }];
  const names = sheetNames(list);
  const enc = new TextEncoder();
  const file = (name: string, text: string): ZipEntry => ({ name, data: enc.encode(text) });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const commented = list.map((sheet, i) => (commentsOf(sheet).length ? i : -1)).filter((i) => i >= 0);
  return createZipBytes([
    file(
      '[Content_Types].xml',
      `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        commented.map((i) => `<Override PartName="/xl/comments${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`).join('') +
        '</Types>'
    ),
    file(
      '_rels/.rels',
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
    file(
      'xl/workbook.xml',
      `${xml}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((name, i) => `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        // The auto filter of each sheet needs its defined name for Excel to keep it.
        `<definedNames>${list
          .map((sheet, i) =>
            sheet.header.length
              ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEscape(names[i].replace(/'/g, "''"))}'!$A$1:$${columnName(Math.max(sheet.header.length, 1) - 1)}$${sheet.rows.length + 1}</definedName>`
              : ''
          )
          .join('')}</definedNames>` +
        '</workbook>'
    ),
    file(
      'xl/_rels/workbook.xml.rels',
      `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    ),
    file(
      'xl/styles.xml',
      `${xml}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        `<fills count="${3 + FILL_ORDER.length}">` +
        '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>' +
        FILL_ORDER.map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="${FILLS[f]}"/><bgColor indexed="64"/></patternFill></fill>`).join('') +
        '</fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${2 + FILL_ORDER.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        FILL_ORDER.map((_, i) => `<xf numFmtId="0" fontId="0" fillId="${3 + i}" borderId="0" xfId="0" applyFill="1"/>`).join('') +
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>'
    ),
    ...list.map((sheet, i) => file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet))),
    ...commented.flatMap((i) => [
      file(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${i + 1}.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing${i + 1}.vml"/>` +
          '</Relationships>'
      ),
      file(`xl/comments${i + 1}.xml`, commentsXml(list[i])),
      file(`xl/drawings/vmlDrawing${i + 1}.vml`, vmlXml(list[i], i)),
    ]),
  ]);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** CSV text with a BOM so Excel reads Thai. */
export function sheetToCsv(sheet: Sheet) {
  const cell = (v: Cell) => `"${(v === null || v === undefined ? '' : String(v)).replaceAll('"', '""')}"`;
  return '﻿' + [sheet.header.map(cell).join(','), ...sheet.rows.map((r) => r.map(cell).join(','))].join('\n');
}
