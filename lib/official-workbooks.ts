/** Server-only OOXML adapter. The caller must authorize every supplied snapshot.
 * Only mapped input cell bodies are changed. No spreadsheet round-trip, macro
 * execution, formula evaluation, source-answer inference, or network access.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import templatesData from '@/private-data/official-workbook-templates.json';
import { coverage, getFields, getSystem, type CoverageEntry, type Field, type FieldColumn } from './catalog';
import { canonical, fingerprint, isNotApplicable, isUnknown, type Answer, type Answers, type SystemSnapshot } from './progress';

export type OfficialWorkbookKind = 'esf' | 'ases' | 'ses';
export type OfficialTranslationSnapshot = {
  systemId: string; sourceRevision: number; sourceHash: string; isCurrent: boolean;
  englishAnswers: Answers; fieldStates: Record<string, 'ready' | 'pending' | 'failed'>;
};
export type OfficialWorkbookInput = {
  kind: OfficialWorkbookKind;
  snapshots: readonly SystemSnapshot[];
  translations?: readonly OfficialTranslationSnapshot[];
  generatedAt?: string;
};
export type OfficialCellStatus = 'written' | 'empty' | 'unknown' | 'not_applicable' |
  'translation_pending' | 'translation_failed' | 'manual_mapping' | 'evidence_required' |
  'invalid_value' | 'protected' | 'out_of_scope' | 'overflow' | 'source_conflict' | 'restricted';
export type OfficialFieldResult = {
  controlId: string; systemId: string | null; fieldId?: string; columnId?: string;
  sheet: string; ranges: string[]; status: OfficialCellStatus; message: string;
  writtenCells: string[]; rowIds?: string[]; sourceRevision?: number;
  sourceReviewPending?: boolean; engineeringReviewed?: boolean;
};
export type OfficialCellWrite = {
  sheet: string; cell: string; type: 'text' | 'number'; value: string;
  systemId: string; fieldId: string; columnId?: string; rowId?: string;
  sourceRevision: number; sourceHash: string; controlId: string;
};
export type OfficialWorkbookReport = {
  format: 'BIU-OFFICIAL-WORKBOOK-DRAFT'; version: 1; kind: OfficialWorkbookKind;
  workingSeason: 2027; generatedAt: string; readyForSubmission: false;
  template: { filename: string; year: number; sha256: string; submission2027Verified: false };
  sourceSnapshots: { systemId: string; revision: number; sourceHash: string }[];
  projectMetadata: { key: 'team_name' | 'university' | 'competition_year'; sheet: string; cell: string; value?: string; type: 'text' | 'number'; source: 'project_identity' | 'saved_answer'; status: 'written' | 'saved_answer_pending'; lockedCellOverride: boolean }[];
  fields: OfficialFieldResult[]; writtenCells: OfficialCellWrite[];
  clearedTemplateValues: { sheet: string; cell: string; controlId: string }[];
  preservedTemplateValues: { sheet: string; cell: string; controlId: string; reason: string }[];
  unmappedSourceFields: { systemId: string; fieldId: string }[];
  changedParts: string[]; formulaResults: 'not_calculated_open_in_excel';
  warnings: string[];
};
export type OfficialWorkbookSheet = { name: string; index: number; state: string };
export type OfficialWorkbookResult = {
  bytes: Uint8Array; filename: string; mime: string;
  report: OfficialWorkbookReport; sheets: OfficialWorkbookSheet[];
};
type TemplateSheet = { name: string; path: string; state: string; writableCells: string[]; formulaCells: string[] };
type Template = { filename: string; year: number; sha256: string; base64: string; sheets: TemplateSheet[] };
type Cell = { xml: string; attributes: string; body: string; ref: string };
type Patch = { type: 'text' | 'number'; value: string } | null;
type InputSchema = { type?: string; unit?: string | null; source_literal_options?: unknown[]; manual_review_before_source_export?: boolean };
const templates = templatesData as unknown as Record<OfficialWorkbookKind, Template>;
// Audited against the immutable templates and explicitly authorized project
// identity. ASES has no team-name or competition-season input: its Read_Me!A1
// is the template edition and must remain 2026. No formula is an override target.
const projectIdentity: Record<OfficialWorkbookKind, { key: 'team_name' | 'university' | 'competition_year'; sheet: string; cell: string; value: string; type: 'text' | 'number'; fieldId?: string; lockedTemplateValue?: string }[]> = {
  esf: [
    { key: 'team_name', sheet: 'Overview', cell: 'L11', value: 'BIU Racing', type: 'text', fieldId: 'LC-ESF-S01-L11' },
    { key: 'university', sheet: 'Overview', cell: 'L12', value: 'Bar-Ilan University', type: 'text', fieldId: 'LC-ESF-S01-L12' },
    { key: 'competition_year', sheet: 'Overview', cell: 'L13', value: '2027', type: 'number', lockedTemplateValue: '2023' },
  ],
  ses: [],
  ases: [{ key: 'university', sheet: 'Cover Sheet', cell: 'D15', value: 'Bar-Ilan University', type: 'text', fieldId: 'LC-ASES-S04-D15' }],
};
const encoder = new TextEncoder();
const sha256 = async (value: string | Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', (typeof value === 'string' ? encoder.encode(value) : value) as BufferSource))).map(n => n.toString(16).padStart(2, '0')).join('');
const textEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
function xmlText(value: string) { return value.replace(/[&<>"']/g, character => textEscapes[character]); }
function attr(attributes: string, key: string) { return new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attributes)?.[1]; }
function cells(xml: string, needed: Set<string>): Map<string, Cell> {
  const result = new Map<string, Cell>();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(match[1], 'r');
    if (ref && needed.has(ref)) result.set(ref, { xml: match[0], attributes: match[1], body: match[2] ?? '', ref });
  }
  return result;
}
function hasValue(cell: Cell | undefined) { return !!cell && /<(?:v|is)\b/.test(cell.body); }
function point(ref: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref);
  if (!match) return null;
  let column = 0; for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  return column <= 16384 && row <= 1048576 ? { row, column } : null;
}
function address(column: number, row: number) {
  let letters = ''; while (column) { column--; letters = String.fromCharCode(65 + column % 26) + letters; column = Math.floor(column / 26); }
  return letters + row;
}
/** Expansion is intentionally bounded. Large evidence canvases are not cells to fill. */
function targetCells(ranges: string[]): string[] | null {
  const result: string[] = [];
  for (const range of ranges) {
    const [left, right = left, ...extra] = range.split(':');
    const from = point(left), to = point(right);
    if (extra.length || !from || !to || to.row < from.row || to.column < from.column || (to.row - from.row + 1) * (to.column - from.column + 1) + result.length > 2000) return null;
    for (let row = from.row; row <= to.row; row++) for (let column = from.column; column <= to.column; column++) result.push(address(column, row));
  }
  return new Set(result).size === result.length ? result : null;
}
function verticalTargets(ranges: string[]) {
  const refs = targetCells(ranges);
  if (!refs?.length) return null;
  const points = refs.map(ref => point(ref)!);
  if (new Set(points.map(p => p.column)).size !== 1 || points.some((p, index) => index && p.row <= points[index - 1].row)) return null;
  return refs;
}
function plainScalar(answer: Answer | undefined): answer is Answer & { value: string } { return !!answer && typeof answer.value === 'string'; }
function schemaFor(entry: CoverageEntry, field?: Field, column?: FieldColumn): InputSchema {
  const mapped = (column?.sourceInputSchema ?? field?.sourceInputSchema ?? {}) as InputSchema;
  return { ...entry.inputSchema, ...mapped, manual_review_before_source_export: !!(entry.inputSchema?.manual_review_before_source_export || mapped.manual_review_before_source_export) } as InputSchema;
}
function literalOptions(schema: InputSchema, field?: Field, column?: FieldColumn): string[] {
  // Original workbook literals win. Display labels and translated enums are not values.
  if (schema.source_literal_options?.length) return schema.source_literal_options.flatMap(value => {
    if (typeof value === 'string') return [value];
    if (value && typeof value === 'object' && 'source_value' in value && typeof value.source_value === 'string') return [value.source_value];
    return [];
  });
  return (column?.options ?? field?.options ?? []).map(option => option.value);
}
function isEvidence(schema: InputSchema, field?: Field, column?: FieldColumn) {
  return (column?.kind ?? field?.kind) === 'file' || schema.type === 'file_upload_with_caption';
}
function validNumber(value: string) {
  // No paragraphs, unit guessing, locale guessing, ranges, or Excel formulas.
  const trimmed = value.trim();
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed)) && trimmed.replace(/[^\d]/g, '').length <= 15;
}
function safeText(value: string) {
  return value.length <= 32767 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value) && !/[\u0590-\u05FF]/u.test(value);
}
function translatedShapeMatches(original: Answer, translated: Answer | undefined) {
  if (!translated || translated.status !== original.status || Array.isArray(original.value) !== Array.isArray(translated.value)) return false;
  if (Array.isArray(original.value) && Array.isArray(translated.value)) {
    const rows = translated.value;
    return original.value.length === rows.length && original.value.every((row, index) => row._id === rows[index]._id && canonical(Object.keys(row).sort()) === canonical(Object.keys(rows[index]).sort()));
  }
  return true;
}
function writeCell(cell: Cell, patch: Patch) {
  if (/<f\b/.test(cell.body)) throw new Error('Refusing to replace a workbook formula');
  const attributes = cell.attributes.replace(/\s+t="[^"]*"/g, '').replace(/\s*\/$/, '');
  // Preserve all non-value children (e.g. extension metadata), styles and attributes.
  const extra = cell.body.replace(/<v\b[^>]*>[\s\S]*?<\/v>|<v\b[^>]*\/>|<is\b[^>]*>[\s\S]*?<\/is>|<is\b[^>]*\/>/g, '');
  if (!patch) return `<c${attributes}>${extra}</c>`;
  const value = patch.type === 'number' ? `<v>${xmlText(patch.value)}</v>` : `<is><t xml:space="preserve">${xmlText(patch.value)}</t></is>`;
  return `<c${attributes}${patch.type === 'text' ? ' t="inlineStr"' : ''}>${value}${extra}</c>`;
}
function patchSheet(xml: string, patches: Map<string, Patch>, writable: Set<string>) {
  const found = new Set<string>();
  const result = xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (all: string, attributes: string, body?: string) => {
    const ref = attr(attributes, 'r');
    if (!ref || !patches.has(ref)) return all;
    if (!writable.has(ref)) throw new Error('Refusing to replace a protected workbook cell');
    found.add(ref);
    return writeCell({ xml: all, attributes, body: body ?? '', ref }, patches.get(ref)!);
  });
  if (found.size !== patches.size) throw new Error('An authorized workbook target is missing from the template');
  return result;
}

const messages: Record<OfficialCellStatus, string> = {
  written: 'התוכן הועבר לתאי התבנית. זו טיוטה, ללא אישור הנדסי.',
  empty: 'טרם נשמרה תשובה לשדה.', unknown: 'התוכן עדיין לא נקבע ולכן לא הוזן ערך סופי.',
  not_applicable: 'אי־תחולה נשמרה במקור. לא הומצא ערך בחירה בתבנית.',
  translation_pending: 'התשובה בעברית נשמרה; התרגום התואם עדיין ממתין.',
  translation_failed: 'עדכון הטקסט באנגלית לא הושלם.',
  manual_mapping: 'המיפוי דורש הכרעה או מבנה נתונים נוסף לפני כתיבה לתאים.',
  evidence_required: 'ראיה נשמרת כקובץ מקורי. היא טרם שובצה באזור המתאים בחוברת.',
  invalid_value: 'הערך אינו מתאים לסוג או לאפשרויות של תא המקור.',
  protected: 'זהו תא נעול, תא נוסחה או יעד שאינו קלט מאומת.',
  out_of_scope: 'לא התקבל צילום מצב מורשה של המערכת הזו.',
  overflow: 'מספר הרשומות חורג ממספר השורות הממופות בתבנית. הטבלה לא נכתבה חלקית.',
  source_conflict: 'התרגום או מבנה השורות אינם תואמים לגרסת המקור.',
  restricted: 'פרטי קשר מוגבלים אינם ממולאים אוטומטית.',
};

/** Creates a fresh working copy, never modifies the source template or snapshots. */
export async function buildOfficialWorkbook(input: OfficialWorkbookInput): Promise<OfficialWorkbookResult> {
  if (input.kind === 'ses') { const { buildSesWorkbook } = await import('./ses-workbook'); return buildSesWorkbook(input); }
  if (!['esf', 'ases'].includes(input.kind)) throw new Error('Unknown official workbook');
  const template = templates[input.kind];
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid workbook date');
  const snapshots = new Map<string, SystemSnapshot>();
  for (const snapshot of input.snapshots) {
    if (!getSystem(snapshot.id) || snapshots.has(snapshot.id) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('Invalid or duplicate source snapshot');
    snapshots.set(snapshot.id, snapshot);
  }
  const hashes = new Map(await Promise.all([...snapshots].map(async ([id, snapshot]) => [id, await sha256(canonical(snapshot.answers))] as const)));
  const translations = new Map<string, OfficialTranslationSnapshot>();
  for (const translation of input.translations ?? []) {
    if (translations.has(translation.systemId)) throw new Error('Duplicate translation snapshot');
    translations.set(translation.systemId, translation);
  }
  const original = Uint8Array.from(atob(template.base64), character => character.charCodeAt(0));
  if (await sha256(original) !== template.sha256) throw new Error('Official workbook template checksum mismatch');
  const parts = unzipSync(original);
  const sheets = new Map(template.sheets.map(sheet => [sheet.name, { ...sheet, xml: strFromU8(parts[sheet.path]), writable: new Set(sheet.writableCells), patches: new Map<string, Patch>() }]));
  const entries = coverage.entries.filter(entry => entry.official.document.toLowerCase() === input.kind);
  if (entries.some(entry => entry.official.templateHash !== template.sha256)) throw new Error('Workbook mapping belongs to a different template');
  // Templates contain many thousands of styled empty canvas cells. Index only
  // actual mapped value targets, keeping Worker memory independent of canvases.
  const needed = new Map<string, Set<string>>();
  for (const entry of entries) if (entry.inputSchema.type !== 'file_upload_with_caption') {
    const refs = targetCells(entry.official.ranges); if (!refs) continue;
    const set = needed.get(entry.official.sheet) ?? new Set<string>();
    for (const ref of refs) set.add(ref);
    needed.set(entry.official.sheet, set);
  }
  for (const metadata of projectIdentity[input.kind]) {
    const set = needed.get(metadata.sheet) ?? new Set<string>(); set.add(metadata.cell); needed.set(metadata.sheet, set);
  }
  const cellIndexes = new Map([...sheets].map(([name, sheet]) => [name, cells(sheet.xml, needed.get(name) ?? new Set())]));
  const report: OfficialWorkbookReport = {
    format: 'BIU-OFFICIAL-WORKBOOK-DRAFT', version: 1, kind: input.kind, workingSeason: 2027, generatedAt, readyForSubmission: false,
    template: { filename: template.filename, year: template.year, sha256: template.sha256, submission2027Verified: false },
    sourceSnapshots: [...snapshots].map(([systemId, snapshot]) => ({ systemId, revision: snapshot.revision, sourceHash: hashes.get(systemId)! })),
    projectMetadata: [], fields: [], writtenCells: [], clearedTemplateValues: [], preservedTemplateValues: [], unmappedSourceFields: [], changedParts: [], formulaResults: 'not_calculated_open_in_excel',
    warnings: [
      `טיוטת BIU Racing לעונת 2027 על בסיס תבנית Italy ${template.year}. תבנית הגשה לאיטליה 2027 טרם אומתה.`,
      'ברירות מחדל נמחקו רק מתאי קלט ממופים שאינם נעולים או נוסחאות. ערכים מוגנים שנשארו הם ערכי תבנית ולא תשובות BIU.',
      'הנוסחאות נשמרות. השרת אינו מחשב אותן ואינו מפעיל מאקרו; יש לפתוח ביישום Excel תואם לחישוב מחדש.',
      'הקובץ אינו אישור הנדסי. מצב תרגום, בדיקת צוות, תחולה וראיות נשמרים בנפרד בדוח.',
    ],
  };
  const referencedFields = new Set<string>();
  const assignedCells = new Set<string>();
  for (const entry of entries) {
    const systemId = entry.systemId ?? (entry.privateContact ? null : 'COORDINATOR');
    const snapshot = systemId ? snapshots.get(systemId) : undefined;
    const field = systemId && entry.fieldId ? getFields(systemId).find(field => field.id === entry.fieldId) : undefined;
    const column = field?.columns?.find(column => column.id === entry.columnId);
    const schema = schemaFor(entry, field, column);
    const sheet = sheets.get(entry.official.sheet);
    if (!sheet) throw new Error('Mapped worksheet is missing');
    const refs = targetCells(entry.official.ranges);
    const index = cellIndexes.get(sheet.name)!;
    const result: OfficialFieldResult = { controlId: entry.id, systemId, fieldId: entry.fieldId, columnId: entry.columnId, sheet: sheet.name, ranges: entry.official.ranges, status: 'empty', message: messages.empty, writtenCells: [], ...(snapshot ? { sourceRevision: snapshot.revision } : {}) };
    report.fields.push(result);
    if (systemId && entry.fieldId) referencedFields.add(systemId + ':' + entry.fieldId);
    const setStatus = (status: OfficialCellStatus) => { result.status = status; result.message = messages[status]; };
    // Clear only verified scalar / table inputs. Evidence canvases and template
    // instructions are never blanked through a broad rectangular range.
    if (refs && !isEvidence(schema, field, column) && (refs.length === 1 || verticalTargets(entry.official.ranges))) {
      for (const ref of refs) {
        if (!hasValue(index.get(ref))) continue;
        if (sheet.writable.has(ref)) {
          if (!sheet.patches.has(ref)) report.clearedTemplateValues.push({ sheet: sheet.name, cell: ref, controlId: entry.id });
          sheet.patches.set(ref, null);
        } else if (!sheet.formulaCells.includes(ref)) report.preservedTemplateValues.push({ sheet: sheet.name, cell: ref, controlId: entry.id, reason: 'protected_template_value' });
      }
    }
    if (entry.privateContact) { setStatus('restricted'); continue; }
    if (!snapshot) { setStatus('out_of_scope'); continue; }
    if (!field || (entry.columnId && !column)) { setStatus('manual_mapping'); continue; }
    const answer = snapshot.answers[field.id];
    if (!answer) continue;
    result.sourceReviewPending = answer.sourceReview === 'pending';
    const reviewed = snapshot.review.fields?.[field.id];
    result.engineeringReviewed = reviewed?.verdict === 'approved' && reviewed.fingerprint === fingerprint(answer);
    if (answer.status === 'unknown') { setStatus('unknown'); continue; }
    if (answer.status === 'na') { setStatus('not_applicable'); continue; }
    if (isEvidence(schema, field, column)) { setStatus('evidence_required'); continue; }
    if (schema.manual_review_before_source_export || field.needsClarification || schema.type === 'linked_record_picker') { setStatus('manual_mapping'); continue; }
    if (!refs?.length || (field.kind !== 'table' && refs.length !== 1) || (field.kind !== 'table' && schema.type === 'repeating_table_column')) { setStatus('manual_mapping'); continue; }
    if (refs.some(ref => !sheet.writable.has(ref) || !index.has(ref))) { setStatus('protected'); continue; }
    const translation = translations.get(snapshot.id);
    const translationCurrent = translation?.isCurrent && translation.sourceRevision === snapshot.revision && translation.sourceHash === hashes.get(snapshot.id);
    const englishAnswer = translationCurrent && translation?.fieldStates[field.id] === 'ready' ? translation.englishAnswers[field.id] : undefined;
    const shapeMatches = !englishAnswer || translatedShapeMatches(answer, englishAnswer);
    if (!shapeMatches) { setStatus('source_conflict'); continue; }
    let items: { ref: string; original: string; english?: string; rowId?: string }[] = [];
    if (entry.columnId) {
      if (field.kind !== 'table' || !Array.isArray(answer.value) || !column) { setStatus('manual_mapping'); continue; }
      const englishRows = Array.isArray(englishAnswer?.value) ? englishAnswer.value : undefined;
      if (new Set(answer.value.map(row => row._id)).size !== answer.value.length || answer.value.some(row => !row._id)) { setStatus('source_conflict'); continue; }
      if ((field.recordKeys?.length ?? 0) > 1) {
        const slot = field.recordKeys!.indexOf(entry.sourceRecordKey ?? '');
        if (slot < 0 || refs.length !== 1) { setStatus('manual_mapping'); continue; }
        if (answer.value.length > field.recordKeys!.length) { setStatus('overflow'); continue; }
        const row = answer.value[slot];
        if (row) items = [{ ref: refs[0], original: row[entry.columnId] ?? '', english: englishRows?.[slot]?.[entry.columnId], rowId: row._id }];
      } else {
        const vertical = verticalTargets(entry.official.ranges);
        if (!vertical) { setStatus('manual_mapping'); continue; }
        if (answer.value.length > vertical.length) { setStatus('overflow'); continue; }
        items = answer.value.map((row, rowIndex) => ({ ref: vertical[rowIndex], original: row[entry.columnId!] ?? '', english: englishRows?.[rowIndex]?.[entry.columnId!], rowId: row._id }));
      }
    } else {
      if (!plainScalar(answer) || field.kind === 'table') { setStatus('manual_mapping'); continue; }
      items = [{ ref: refs[0], original: answer.value, english: plainScalar(englishAnswer) ? englishAnswer.value : undefined }];
    }
    if (!items.length || items.every(item => !item.original.trim())) continue;
    // An invalid cell never becomes a false value. Other independent rows may
    // still be present in the draft, and the control remains visibly unresolved.
    let unresolved: OfficialCellStatus | undefined;
    for (const item of items) {
      if (!item.original.trim()) { unresolved ??= 'empty'; continue; }
      if (isUnknown(item.original)) { unresolved ??= 'unknown'; continue; }
      if (isNotApplicable(item.original)) { unresolved ??= 'not_applicable'; continue; }
      let value = item.original, type: 'number' | 'text' = 'text';
      if (schema.type === 'number_with_unit_and_source') {
        if (!validNumber(value)) { unresolved ??= 'invalid_value'; continue; }
        value = value.trim(); type = 'number';
      } else if (schema.type === 'select' || (column?.kind ?? field.kind) === 'select') {
        if (!literalOptions(schema, field, column).includes(value)) { unresolved ??= 'invalid_value'; continue; }
      } else {
        if (!englishAnswer || item.english === undefined) {
          unresolved ??= translation && !translationCurrent ? 'source_conflict' : translation?.fieldStates[field.id] === 'failed' ? 'translation_failed' : 'translation_pending';
          continue;
        }
        value = item.english;
        if (!value.trim() || !safeText(value)) { unresolved ??= 'invalid_value'; continue; }
      }
      const key = sheet.name + '!' + item.ref;
      if (assignedCells.has(key)) throw new Error('Overlapping workbook answer mappings');
      assignedCells.add(key);
      sheet.patches.set(item.ref, { type, value });
      result.writtenCells.push(item.ref);
      if (item.rowId) (result.rowIds ??= []).push(item.rowId);
      report.writtenCells.push({ sheet: sheet.name, cell: item.ref, type, value, systemId: snapshot.id, fieldId: field.id, ...(entry.columnId ? { columnId: entry.columnId } : {}), ...(item.rowId ? { rowId: item.rowId } : {}), sourceRevision: snapshot.revision, sourceHash: hashes.get(snapshot.id)!, controlId: entry.id });
    }
    setStatus(unresolved ?? (result.writtenCells.length ? 'written' : 'empty'));
  }
  for (const [systemId, snapshot] of snapshots) for (const fieldId of Object.keys(snapshot.answers)) {
    if (!referencedFields.has(systemId + ':' + fieldId)) report.unmappedSourceFields.push({ systemId, fieldId });
  }
  const identityOverrides = new Map<string, Set<string>>();
  for (const metadata of projectIdentity[input.kind]) {
    const savedAnswer = metadata.fieldId ? snapshots.get('COORDINATOR')?.answers[metadata.fieldId] : undefined;
    const written = report.writtenCells.find(write => write.sheet === metadata.sheet && write.cell === metadata.cell);
    const item: OfficialWorkbookReport['projectMetadata'][number] = { key: metadata.key, sheet: metadata.sheet, cell: metadata.cell, type: metadata.type, source: savedAnswer ? 'saved_answer' : 'project_identity', status: savedAnswer && !written ? 'saved_answer_pending' : 'written', lockedCellOverride: false, ...(written ? { value: written.value } : {}) };
    report.projectMetadata.push(item);
    // An explicit saved answer, even unknown or deliberately cleared, wins over
    // the project default. Its normal mapping/translation status remains visible.
    if (savedAnswer) continue;
    const sheet = sheets.get(metadata.sheet)!, cell = cellIndexes.get(metadata.sheet)?.get(metadata.cell);
    if (!cell || /<f\b/.test(cell.body)) throw new Error('Invalid audited project identity cell');
    if (!sheet.writable.has(metadata.cell)) {
      const originalValue = /<v\b[^>]*>([^<]*)<\/v>/.exec(cell.body)?.[1];
      if (metadata.lockedTemplateValue === undefined || originalValue !== metadata.lockedTemplateValue || input.kind !== 'esf' || metadata.sheet !== 'Overview' || metadata.cell !== 'L13') throw new Error('Unaudited locked project identity cell');
      const allowed = identityOverrides.get(metadata.sheet) ?? new Set<string>(); allowed.add(metadata.cell); identityOverrides.set(metadata.sheet, allowed);
      item.lockedCellOverride = true;
    }
    sheet.patches.set(metadata.cell, { type: metadata.type, value: metadata.value }); item.value = metadata.value;
  }
  for (const sheet of sheets.values()) if (sheet.patches.size) {
    parts[sheet.path] = strToU8(patchSheet(sheet.xml, sheet.patches, new Set([...sheet.writable, ...(identityOverrides.get(sheet.name) ?? [])])));
    report.changedParts.push(sheet.path);
  }
  // Preserve every formula and cached value. Force full recalculation in a
  // compatible spreadsheet app; previews must not portray old caches as results.
  const workbookXml = strFromU8(parts['xl/workbook.xml']);
  const calc = /<calcPr\b([^>]*?)(?:\/>|>[\s\S]*?<\/calcPr>)/;
  const recalc = (attributes: string) => `<calcPr${attributes.replace(/\s+(?:fullCalcOnLoad|forceFullCalc|calcMode)="[^"]*"/g, '').replace(/\s*\/$/, '')} fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>`;
  parts['xl/workbook.xml'] = strToU8(calc.test(workbookXml) ? workbookXml.replace(calc, (_all, attributes: string) => recalc(attributes)) : workbookXml.replace('</workbook>', `${recalc('')}</workbook>`));
  report.changedParts.push('xl/workbook.xml');
  const extension = input.kind === 'ases' ? 'xlsm' : 'xlsx';
  const filename = `BIU_Racing_2027_${input.kind.toUpperCase()}_WORKING_DRAFT_template_${template.year}.${extension}`;
  return {
    bytes: zipSync(parts, { level: 6 }), filename,
    mime: input.kind === 'ases' ? 'application/vnd.ms-excel.sheet.macroEnabled.12' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    report, sheets: template.sheets.map((sheet, index) => ({ name: sheet.name, index, state: sheet.state })),
  };
}

export const getOfficialWorkbook = buildOfficialWorkbook;

export type { WorkbookPreview, WorkbookPreviewCell, WorkbookCSS } from './official-workbook-preview';
/** Parses only a known sheet of an already-built, authorized working copy. */
export async function getOfficialWorkbookSheet(input: { workbook: OfficialWorkbookResult; sheet: string }) {
  const kind = input.workbook.report.kind;
  const template = templates[kind];
  if (!template || input.workbook.report.template.sha256 !== template.sha256) throw new Error('Unknown workbook template');
  const sheet = template.sheets.find(sheet => sheet.name === input.sheet);
  if (!sheet) throw new Error('Unknown worksheet');
  const { parseOfficialWorkbookSheet } = await import('./official-workbook-preview');
  return parseOfficialWorkbookSheet(input.workbook, input.sheet, sheet.path);
}
