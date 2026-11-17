import { guard, session, readSystem, database, readJson, ApiError, json } from '@/lib/server';
import { systems } from '@/lib/catalog';
import { buildOfficialWorkbook, getOfficialWorkbookSheet, type OfficialWorkbookKind } from '@/lib/official-workbooks';
import { getTranslationSnapshot } from '@/lib/translation';
import { translationConfig } from '@/lib/translation-runtime';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ kind: string }> };
function documentKind(value: string): OfficialWorkbookKind {
  if (value !== 'esf' && value !== 'ases' && value !== 'ses') throw new ApiError(404, 'המסמך לא נמצא.');
  return value;
}
async function authorizedDocumentSources() {
  const member = await session();
  const allowed = new Set(member.systemIds);
  const ids = systems.filter(system => allowed.has(system.id)).map(system => system.id);
  if (member.role === 'coordinator') ids.push('COORDINATOR');
  const snapshots = await Promise.all(ids.map(id => readSystem(id)));
  const config = translationConfig();
  const translations = await Promise.all(snapshots.map(snapshot => getTranslationSnapshot(database(), snapshot, config)));
  return { member, snapshots, translations, config, scope: {
    systemIds: ids, includesCoordinator: member.role === 'coordinator',
    complete: member.role === 'coordinator' && systems.every(system => allowed.has(system.id)),
  } };
}
export async function GET(request: Request, { params }: Context) {
  return guard(request, async () => {
    const kind = documentKind((await params).kind);
    const query = new URL(request.url).searchParams;
    const format = query.get('format') ?? 'view';
    if (!['view', 'download', 'report'].includes(format)) throw new ApiError(400, 'פורמט המסמך אינו נתמך.');
    const { member, snapshots, translations, scope, config } = await authorizedDocumentSources();
    const workbook = await buildOfficialWorkbook({ kind, snapshots, translations });
    if (format === 'download') return new Response(workbook.bytes.slice().buffer, { headers: {
      'Content-Type': workbook.mime,
      'Content-Disposition': `attachment; filename="${workbook.filename}"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'X-BIU-Document-State': 'working-draft',
    } });
    if (format === 'report') return json({ ...workbook.report, scope });
    const requestedSheet = query.get('sheet');
    const sheet = requestedSheet ?? workbook.sheets.find(item => item.state === 'visible')?.name ?? workbook.sheets[0]?.name;
    if (!sheet || !workbook.sheets.some(item => item.name === sheet)) throw new ApiError(404, 'הגיליון לא נמצא.');
    const sheetView = await getOfficialWorkbookSheet({ workbook, sheet });
    return {
      report: workbook.report, sheets: workbook.sheets, sheetView, scope,
      canProcess: member.role !== 'reviewer',
      translationsSummary: {
        systems: translations.map(item => ({ id: item.systemId, revision: item.sourceRevision, status: item.status,
          completedFields: item.completedFields, totalFields: item.totalFields, providerConfigured: item.providerConfigured,
          retryAt: item.retryAt, retryable: item.retryable, errorCode: item.errorCode })),
        completedFields: translations.reduce((count, item) => count + item.completedFields, 0),
        totalFields: translations.reduce((count, item) => count + item.totalFields, 0),
        pendingSystems: translations.filter(item => item.status !== 'ready').length,
        providerConfigured: true,
      },
    };
  });
}
export async function POST(request: Request, { params }: Context) {
  return guard(request, async () => {
    documentKind((await params).kind);
    const body = await readJson(request, 1024);
    if (body.action !== 'process') throw new ApiError(400, 'פעולת המסמך אינה נתמכת.');
    const { member, translations, config } = await authorizedDocumentSources();
    if (member.role === 'reviewer') throw new ApiError(403, 'החשבון מורשה לצפייה ולבדיקה בלבד.');
    return json({ scheduled: false, engine: 'browser-local', systems: translations.filter(item=>item.isCurrent&&item.sourceRevision>0&&item.status!=='ready').map(item=>({id:item.systemId,revision:item.sourceRevision})) }, 202);
  });
}
