/** Read-only rendering metadata for trusted OOXML produced by official-workbooks.
 * This parser neither evaluates formulas nor follows external relationships.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { OfficialWorkbookResult, OfficialFieldResult } from './official-workbooks';

export type WorkbookCSS = Record<string, string | number>;
export type WorkbookPreviewCell = {
  ref: string; row: number; column: number; text: string; rawValue: string;
  styleId: number; formula: boolean; numberFormat: string; rowSpan: number; colSpan: number;
  origin: 'answer' | 'project_metadata' | 'template' | 'blank'; controlIds: string[];
  status?: OfficialFieldResult['status']; styleOverride?: WorkbookCSS;
  runs?: { text: string; style: WorkbookCSS }[];
};
export type WorkbookPreview = {
  name: string; index: number; state: string; rowCount: number; columnCount: number;
  originalDimension: string; defaultRowHeight: number; defaultColumnWidth: number;
  rows: { index: number; height: number; heightPoints: number; hidden: boolean; styleId?: number }[];
  columns: { index: number; width: number; widthCharacters: number; hidden: boolean; styleId?: number }[];
  cells: WorkbookPreviewCell[]; styles: Record<number, WorkbookCSS>;
  merges: { ref: string; row: number; column: number; rowSpan: number; colSpan: number }[];
  images: { id: string; name: string; dataUrl: string; left: number; top: number; width: number; height: number; source: 'template' }[];
  drawings: { kind: 'chart' | 'shape' | 'unsupported_image'; text?: string; left: number; top: number; width: number; height: number }[];
  showGridLines: boolean; rightToLeft: boolean; formulaResults: 'not_calculated_open_in_excel'; warnings: string[];
};
type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string };
const local = (name: string) => name.split(':').at(-1)!;
function decode(value: string) {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_match, hex, decimal, named) => {
    if (hex || decimal) { const n = parseInt(hex || decimal, hex ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[named.toLowerCase()];
  });
}
function xml(value: string): Node {
  const root: Node = { name: '#document', attrs: {}, children: [], text: '' }, stack = [root];
  for (const match of value.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1)!.text += token.slice(9, -3); continue; }
    if (token.startsWith('</')) { if (stack.length < 2) throw new Error('Invalid workbook XML'); stack.pop(); continue; }
    if (token.startsWith('<!')) throw new Error('Unsupported XML declaration');
    if (token.startsWith('<')) {
      const name = /^<([^\s/>]+)/.exec(token)?.[1]; if (!name) throw new Error('Invalid workbook XML node');
      const node: Node = { name: local(name), attrs: {}, children: [], text: '' };
      for (const attribute of token.matchAll(/([^\s=]+)="([^"]*)"/g)) node.attrs[attribute[1]] = decode(attribute[2]);
      stack.at(-1)!.children.push(node); if (!token.endsWith('/>')) stack.push(node);
    } else stack.at(-1)!.text += decode(token);
  }
  if (stack.length !== 1) throw new Error('Unclosed workbook XML');
  return root.children[0] ?? root;
}
const child = (node: Node | undefined, name: string) => node?.children.find(n => n.name === name);
const children = (node: Node | undefined, name: string) => node?.children.filter(n => n.name === name) ?? [];
function descendants(node: Node | undefined, name: string): Node[] { return node ? node.children.flatMap(n => [...(n.name === name ? [n] : []), ...descendants(n, name)]) : []; }
const numeric = (value: string | undefined, fallback: number) => value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
function point(ref: string) {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref); if (!match) throw new Error('Invalid cell reference');
  let column = 0; for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  return { column, row: Number(match[2]) };
}
function range(ref: string) { const [a, b = a] = ref.split(':'); const first = point(a), last = point(b); return { ref, ...first, rowSpan: last.row - first.row + 1, colSpan: last.column - first.column + 1 }; }
function richText(node: Node | undefined, fontStyle: (node?: Node) => WorkbookCSS) {
  const runs = children(node, 'r').map(run => ({ text: children(run, 't').map(t => t.text).join(''), style: fontStyle(child(run, 'rPr')) }));
  return { text: runs.length ? runs.map(run => run.text).join('') : children(node, 't').map(t => t.text).join(''), ...(runs.length ? { runs } : {}) };
}
const indexed = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
function readStyles(parts: Record<string, Uint8Array>) {
  const styles = xml(strFromU8(parts['xl/styles.xml']));
  const theme = parts['xl/theme/theme1.xml'] ? xml(strFromU8(parts['xl/theme/theme1.xml'])) : undefined;
  const themeNodes = descendants(theme, 'clrScheme')[0]?.children ?? [];
  // SpreadsheetML theme indexes use lt1,dk1,lt2,dk2, not the order in which
  // DrawingML serializes those nodes (dk1,lt1,dk2,lt2).
  const themeColors = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map(name => { const color = themeNodes.find(node => node.name === name)?.children[0]; return color?.attrs.lastClr ?? color?.attrs.val ?? '000000'; });
  const color = (node?: Node): string | undefined => {
    if (!node) return undefined;
    let hex = node.attrs.rgb?.slice(-6) ?? (node.attrs.theme ? themeColors[Number(node.attrs.theme)] : undefined) ?? (node.attrs.indexed ? indexed[Number(node.attrs.indexed)] : undefined);
    if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return undefined;
    const tint = numeric(node.attrs.tint, 0);
    if (tint) hex = hex.match(/../g)!.map(v => Math.round(tint < 0 ? parseInt(v, 16) * (1 + tint) : parseInt(v, 16) * (1 - tint) + 255 * tint).toString(16).padStart(2, '0')).join('');
    return '#' + hex;
  };
  const fontStyle = (font?: Node): WorkbookCSS => {
    if (!font) return {};
    const css: WorkbookCSS = {};
    const name = child(font, 'name')?.attrs.val ?? child(font, 'rFont')?.attrs.val;
    if (name && /^[\w .-]{1,80}$/.test(name)) css.fontFamily = name;
    const size = child(font, 'sz')?.attrs.val; if (size) css.fontSize = `${numeric(size, 11)}pt`;
    if (child(font, 'b') && child(font, 'b')?.attrs.val !== '0') css.fontWeight = 700;
    if (child(font, 'i') && child(font, 'i')?.attrs.val !== '0') css.fontStyle = 'italic';
    if (child(font, 'u') && child(font, 'u')?.attrs.val !== 'none') css.textDecoration = 'underline';
    if (child(font, 'strike')) css.textDecoration = 'line-through';
    const textColor = color(child(font, 'color')); if (textColor) css.color = textColor;
    const vertical = child(font, 'vertAlign')?.attrs.val; if (vertical === 'superscript' || vertical === 'subscript') css.verticalAlign = vertical === 'superscript' ? 'super' : 'sub';
    return css;
  };
  const fonts = children(child(styles, 'fonts'), 'font').map(fontStyle);
  const fills = children(child(styles, 'fills'), 'fill').map(fill => { const pattern = child(fill, 'patternFill'); return pattern?.attrs.patternType === 'solid' ? color(child(pattern, 'fgColor')) : undefined; });
  const borders = children(child(styles, 'borders'), 'border').map(border => {
    const css: WorkbookCSS = {};
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const item = child(border, edge), type = item?.attrs.style; if (!type || type === 'none') continue;
      const width = type === 'thick' || type === 'double' ? 3 : type.startsWith('medium') ? 2 : type === 'hair' ? .5 : 1;
      const line = type === 'double' ? 'double' : /dash/i.test(type) ? 'dashed' : /dot/i.test(type) ? 'dotted' : 'solid';
      css['border' + edge[0].toUpperCase() + edge.slice(1)] = `${width}px ${line} ${color(child(item, 'color')) ?? '#000000'}`;
    }
    return css;
  });
  const numberFormats: Record<number, string> = { 0: 'General', 1: '0', 2: '0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 14: 'mm-dd-yy' };
  for (const n of children(child(styles, 'numFmts'), 'numFmt')) numberFormats[Number(n.attrs.numFmtId)] = n.attrs.formatCode;
  const formats: Record<number, string> = {}, css: Record<number, WorkbookCSS> = {};
  children(child(styles, 'cellXfs'), 'xf').forEach((xf, id) => {
    const alignment = child(xf, 'alignment')?.attrs ?? {};
    const style: WorkbookCSS = { ...fonts[Number(xf.attrs.fontId ?? 0)], ...borders[Number(xf.attrs.borderId ?? 0)], whiteSpace: alignment.wrapText === '1' ? 'pre-wrap' : 'pre', verticalAlign: alignment.vertical === 'center' ? 'middle' : alignment.vertical === 'top' ? 'top' : 'bottom' };
    const fill = fills[Number(xf.attrs.fillId ?? 0)]; if (fill) style.backgroundColor = fill;
    if (['left', 'right', 'center', 'justify'].includes(alignment.horizontal)) style.textAlign = alignment.horizontal;
    if (alignment.indent) style.paddingLeft = `${Number(alignment.indent) * 3}ch`;
    if (alignment.readingOrder === '2') style.direction = 'rtl';
    css[id] = style; formats[id] = numberFormats[Number(xf.attrs.numFmtId ?? 0)] ?? 'General';
  });
  return { css, formats, fontStyle };
}
function relationshipPath(part: string) { const i = part.lastIndexOf('/'); return part.slice(0, i + 1) + '_rels/' + part.slice(i + 1) + '.rels'; }
function resolvePart(part: string, target: string) {
  const segments = (target.startsWith('/') ? target.slice(1) : part.slice(0, part.lastIndexOf('/') + 1) + target).split('/'), result: string[] = [];
  for (const segment of segments) { if (segment === '..') result.pop(); else if (segment && segment !== '.') result.push(segment); }
  return result.join('/');
}
function relationships(parts: Record<string, Uint8Array>, part: string) {
  const path = relationshipPath(part), data = parts[path];
  return new Map(data ? children(xml(strFromU8(data)), 'Relationship').filter(r => r.attrs.TargetMode !== 'External').map(r => [r.attrs.Id, resolvePart(part, r.attrs.Target)]) : []);
}
function toBase64(data: Uint8Array) { let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(binary); }

/** Sparse cell grid. Row/column indexes are one-based; image coordinates are px. */
export function parseOfficialWorkbookSheet(workbook: OfficialWorkbookResult, sheetName: string, sheetPath: string): WorkbookPreview {
  const index = workbook.sheets.findIndex(sheet => sheet.name === sheetName); if (index < 0) throw new Error('Unknown worksheet');
  const parts = unzipSync(workbook.bytes), sheet = xml(strFromU8(parts[sheetPath]));
  const style = readStyles(parts);
  const shared = parts['xl/sharedStrings.xml'] ? children(xml(strFromU8(parts['xl/sharedStrings.xml'])), 'si').map(si => richText(si, style.fontStyle)) : [];
  const dimension = child(sheet, 'dimension')?.attrs.ref ?? 'A1';
  const format = child(sheet, 'sheetFormatPr')?.attrs ?? {};
  const defaultRowPoints = numeric(format.defaultRowHeight, 15), defaultColumnCharacters = numeric(format.defaultColWidth, 8.43);
  const rowNodes = children(child(sheet, 'sheetData'), 'row');
  const columnNodes = children(child(sheet, 'cols'), 'col');
  const merges = children(child(sheet, 'mergeCells'), 'mergeCell').map(m => range(m.attrs.ref));
  const writes = new Map(workbook.report.writtenCells.filter(c => c.sheet === sheetName).map(c => [c.cell, c]));
  const metadata = new Set(workbook.report.projectMetadata.filter(c => c.sheet === sheetName && c.source === 'project_identity' && c.status === 'written').map(c => c.cell));
  const inputControls = workbook.report.fields.filter(f => f.sheet === sheetName);
  // Dimension commonly includes hundreds of blank formatted rows. Extent uses
  // real content, merges and actual input ranges; nothing meaningful is cropped.
  let rowCount = 1, columnCount = 1;
  const grow = (row: number, column: number) => { rowCount = Math.max(rowCount, row); columnCount = Math.max(columnCount, column); };
  const cells: WorkbookPreviewCell[] = [];
  for (const row of rowNodes) for (const cell of children(row, 'c')) {
    const ref = cell.attrs.r; if (!ref) continue;
    const p = point(ref), formula = !!child(cell, 'f'), value = child(cell, 'v')?.text ?? '';
    const textValue = cell.attrs.t === 's' ? (shared[Number(value)] ?? { text: '' }) : cell.attrs.t === 'inlineStr' ? richText(child(cell, 'is'), style.fontStyle) : { text: value };
    const styleId = Number(cell.attrs.s ?? row.attrs.s ?? columnNodes.find(c => p.column >= Number(c.attrs.min) && p.column <= Number(c.attrs.max))?.attrs.style ?? 0);
    if (textValue.text || formula) grow(p.row, p.column);
    cells.push({ ref, ...p, text: formula ? '' : textValue.text, rawValue: formula ? '' : value, styleId, formula, numberFormat: style.formats[styleId] ?? 'General', rowSpan: 1, colSpan: 1, origin: writes.has(ref) ? 'answer' : metadata.has(ref) ? 'project_metadata' : textValue.text || formula ? 'template' : 'blank', controlIds: [], ...(!formula && 'runs' in textValue ? { runs: textValue.runs } : {}) });
  }
  for (const merge of merges) grow(merge.row + merge.rowSpan - 1, merge.column + merge.colSpan - 1);
  for (const control of inputControls) for (const ref of control.ranges) { const r = range(ref); grow(r.row + r.rowSpan - 1, r.column + r.colSpan - 1); }
  const rels = relationships(parts, sheetPath), anchors: { node: Node; drawingPart: string }[] = [];
  for (const drawing of children(sheet, 'drawing')) {
    const part = rels.get(drawing.attrs['r:id']); if (!part || !parts[part]) continue;
    for (const node of xml(strFromU8(parts[part])).children) {
      if (!['oneCellAnchor', 'twoCellAnchor', 'absoluteAnchor'].includes(node.name)) continue;
      for (const marker of [child(node, 'from'), child(node, 'to')]) if (marker) grow(numeric(child(marker, 'row')?.text, 0) + 1, numeric(child(marker, 'col')?.text, 0) + 1);
      anchors.push({ node, drawingPart: part });
    }
  }
  if (rowCount > 5000 || columnCount > 300) throw new Error('Worksheet preview exceeds safe dimensions');
  const rows = Array.from({ length: rowCount }, (_, i) => {
    const row = rowNodes.find(r => Number(r.attrs.r) === i + 1); const points = numeric(row?.attrs.ht, defaultRowPoints);
    return { index: i + 1, height: points * 4 / 3, heightPoints: points, hidden: row?.attrs.hidden === '1', ...(row?.attrs.s ? { styleId: Number(row.attrs.s) } : {}) };
  });
  const columns = Array.from({ length: columnCount }, (_, i) => {
    const col = columnNodes.find(c => i + 1 >= Number(c.attrs.min) && i + 1 <= Number(c.attrs.max)); const width = numeric(col?.attrs.width, defaultColumnCharacters);
    // Excel character widths are font-dependent; keep exact source units too.
    return { index: i + 1, width: width < 1 ? Math.round(width * 12) : Math.floor(width * 7 + 5), widthCharacters: width, hidden: col?.attrs.hidden === '1', ...(col?.attrs.style ? { styleId: Number(col.attrs.style) } : {}) };
  });
  const cellMap = new Map(cells.map(cell => [cell.ref, cell]));
  for (const control of inputControls) for (const ref of control.ranges) {
    const r = range(ref);
    for (const cell of cells) if (cell.row >= r.row && cell.row < r.row + r.rowSpan && cell.column >= r.column && cell.column < r.column + r.colSpan) { cell.controlIds.push(control.controlId); cell.status = writes.has(cell.ref) || metadata.has(cell.ref) ? 'written' : control.status; }
  }
  for (const merge of merges) {
    const anchor = cellMap.get(merge.ref.split(':')[0]); if (!anchor) continue;
    anchor.rowSpan = merge.rowSpan; anchor.colSpan = merge.colSpan;
    const end = cellMap.get(merge.ref.split(':')[1]);
    const endStyle = end ? style.css[end.styleId] : undefined;
    if (endStyle?.borderRight || endStyle?.borderBottom) anchor.styleOverride = { ...(endStyle?.borderRight ? { borderRight: endStyle.borderRight } : {}), ...(endStyle?.borderBottom ? { borderBottom: endStyle.borderBottom } : {}) };
  }
  const x = [0], y = [0]; for (const col of columns) x.push(x.at(-1)! + (col.hidden ? 0 : col.width)); for (const row of rows) y.push(y.at(-1)! + (row.hidden ? 0 : row.height));
  const marker = (node?: Node) => ({ left: x[numeric(child(node, 'col')?.text, 0)] + numeric(child(node, 'colOff')?.text, 0) / 9525, top: y[numeric(child(node, 'row')?.text, 0)] + numeric(child(node, 'rowOff')?.text, 0) / 9525 });
  const images: WorkbookPreview['images'] = [], drawings: WorkbookPreview['drawings'] = [];
  for (const { node, drawingPart } of anchors) {
    const from = node.name === 'absoluteAnchor' ? { left: numeric(child(node, 'pos')?.attrs.x, 0) / 9525, top: numeric(child(node, 'pos')?.attrs.y, 0) / 9525 } : marker(child(node, 'from'));
    const to = child(node, 'to') ? marker(child(node, 'to')) : undefined;
    const ext = child(node, 'ext'); const bounds = { ...from, width: to ? to.left - from.left : numeric(ext?.attrs.cx, 0) / 9525, height: to ? to.top - from.top : numeric(ext?.attrs.cy, 0) / 9525 };
    const group = child(node, 'grpSp');
    const pictures = child(node, 'pic') ? [child(node, 'pic')!] : children(group, 'pic');
    if (pictures.length) {
      const groupTransform = child(child(group, 'grpSpPr'), 'xfrm');
      for (const picture of pictures) {
        const blip = descendants(picture, 'blip')[0];
        const path = blip ? relationships(parts, drawingPart).get(blip.attrs['r:embed']) : undefined;
        const mime = path?.endsWith('.png') ? 'image/png' : path?.match(/\.jpe?g$/i) ? 'image/jpeg' : undefined;
        let pictureBounds = bounds;
        if (groupTransform) {
          const transform = child(child(picture, 'spPr'), 'xfrm');
          const offset = child(groupTransform, 'chOff')?.attrs, extent = child(groupTransform, 'chExt')?.attrs;
          const sx = bounds.width / numeric(extent?.cx, 1), sy = bounds.height / numeric(extent?.cy, 1);
          pictureBounds = { left: bounds.left + (numeric(child(transform, 'off')?.attrs.x, 0) - numeric(offset?.x, 0)) * sx, top: bounds.top + (numeric(child(transform, 'off')?.attrs.y, 0) - numeric(offset?.y, 0)) * sy, width: numeric(child(transform, 'ext')?.attrs.cx, 0) * sx, height: numeric(child(transform, 'ext')?.attrs.cy, 0) * sy };
        }
        if (path && mime && parts[path]) images.push({ id: path, name: descendants(picture, 'cNvPr')[0]?.attrs.name ?? 'Template image', dataUrl: `data:${mime};base64,${toBase64(parts[path])}`, ...pictureBounds, source: 'template' });
        else drawings.push({ kind: 'unsupported_image', ...pictureBounds });
      }
      if (group && descendants(group, 't').length) drawings.push({ kind: 'shape', text: descendants(group, 't').map(n => n.text).join('\n'), ...bounds });
    } else if (descendants(node, 'chart').length) drawings.push({ kind: 'chart', ...bounds });
    else drawings.push({ kind: 'shape', text: descendants(node, 't').map(n => n.text).join('\n'), ...bounds });
  }
  const view = child(child(sheet, 'sheetViews'), 'sheetView');
  return {
    name: sheetName, index, state: workbook.sheets[index].state, rowCount, columnCount, originalDimension: dimension,
    defaultRowHeight: defaultRowPoints * 4 / 3, defaultColumnWidth: Math.floor(defaultColumnCharacters * 7 + 5), rows, columns,
    cells: cells.filter(c => c.row <= rowCount && c.column <= columnCount), styles: style.css, merges, images, drawings,
    showGridLines: view?.attrs.showGridLines !== '0', rightToLeft: view?.attrs.rightToLeft === '1', formulaResults: 'not_calculated_open_in_excel',
    warnings: ['הנוסחאות נשמרו בקובץ ואינן מחושבות בתצוגה. תוצאות שמורות ישנות מוסתרות.', 'רוחב עמודות ותצוגת גופנים בדפדפן הם קירוב של Excel. קובץ ההורדה שומר את המידות המקוריות.', ...(drawings.length ? ['תרשימים, צורות וציורים מיוחדים נשמרו בקובץ המקורי; התצוגה מסמנת את מיקומם.'] : [])],
  };
}
