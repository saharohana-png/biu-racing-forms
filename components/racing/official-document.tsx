'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent} from 'react';
import {dateLabel,errorText,request} from '@/lib/client-types';
import {scheduleLocalTranslation} from '@/lib/browser-translation';
import type {OfficialWorkbookReport,OfficialWorkbookSheet} from '@/lib/official-workbooks';
import type {WorkbookPreview,WorkbookPreviewCell} from '@/lib/official-workbook-preview';
import styles from './official-document.module.css';

type DocumentKind='esf'|'ases'|'ses';
type TranslationSummary={systems:{id:string;revision:number;status:string;completedFields:number;totalFields:number;providerConfigured:boolean;retryAt?:string|null;retryable?:boolean;errorCode?:string}[];completedFields:number;totalFields:number;providerConfigured:boolean;pendingSystems:number};
type DocumentResponse={report:OfficialWorkbookReport;sheets:OfficialWorkbookSheet[];sheetView:WorkbookPreview;translationsSummary:TranslationSummary;scope:{systemIds:string[];includesCoordinator:boolean;complete:boolean};canProcess:boolean};
const formulaLabel='Calculation pending in Excel';
const cellStatus:Record<string,string>={written:'תשובת BIU',empty:'טרם מולא',unknown:'מידע פתוח',not_applicable:'אי־תחולה לבדיקה',translation_pending:'ממתין לאנגלית',translation_failed:'עדכון האנגלית לא הושלם',manual_mapping:'נדרש מיפוי ידני',evidence_required:'נדרשת ראיה',invalid_value:'הערך דורש בדיקה',protected:'תא תבנית מוגן',out_of_scope:'מחוץ להיקף הגישה',overflow:'התוכן חורג מטווח התבנית',source_conflict:'מקורות דורשים בירור',restricted:'תא מוגבל'};
const retryCandidate=(system:TranslationSummary['systems'][number])=>!['ready','provider_unconfigured'].includes(system.status)&&(system.status!=='failed'||system.retryable===true);
const canTranslate=(summary:TranslationSummary)=>summary.providerConfigured&&summary.pendingSystems>0&&summary.systems.some(system=>retryCandidate(system)&&(!system.retryAt||Date.parse(system.retryAt)<=Date.now()));
function columnName(value:number){let result='';while(value){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26);}return result;}

/** Uses the template's actual sparse cell grid; it never evaluates spreadsheet formulas. */
export function WorkbookSheet({sheet,zoom}:{sheet:WorkbookPreview;zoom:number}){
 const layout=useMemo(()=>{
  const x=[0],y=[0];for(const column of sheet.columns)x.push(x.at(-1)!+(column.hidden?0:column.width));for(const row of sheet.rows)y.push(y.at(-1)!+(row.hidden?0:row.height));
  const mergedRows=new Map<number,typeof sheet.merges>();
  for(const merge of sheet.merges)for(let row=merge.row;row<merge.row+merge.rowSpan;row++)mergedRows.set(row,[...(mergedRows.get(row)||[]),merge]);
  const rows=new Map<number,WorkbookPreviewCell[]>();
  for(const cell of sheet.cells){
   if(sheet.rows[cell.row-1]?.hidden||sheet.columns[cell.column-1]?.hidden)continue;
   if(mergedRows.get(cell.row)?.some(merge=>cell.column>=merge.column&&cell.column<merge.column+merge.colSpan&&(cell.row!==merge.row||cell.column!==merge.column)))continue;
   rows.set(cell.row,[...(rows.get(cell.row)||[]),cell]);
  }
  return{x,y,rows,width:x.at(-1)!+42,height:y.at(-1)!+28};
 },[sheet]);
 const direction=sheet.rightToLeft?'rtl':'ltr';
 return <div className={styles.sheetExtent} style={{width:layout.width*zoom,height:layout.height*zoom}}>
  <div className={styles.sheetCanvas} dir={direction} style={{width:layout.width,height:layout.height,transform:`scale(${zoom})`}}>
   <div className={styles.columnHeaders} aria-hidden="true" style={{height:28,insetInlineStart:42}}>{sheet.columns.filter(column=>!column.hidden).map(column=><span key={column.index} style={{insetInlineStart:layout.x[column.index-1],width:column.width}}>{columnName(column.index)}</span>)}</div>
   <div className={styles.corner} aria-hidden="true"/>
   <div className={styles.rowHeaders} aria-hidden="true">{sheet.rows.filter(row=>!row.hidden).map(row=><span key={row.index} style={{top:layout.y[row.index-1]+28,height:row.height}}>{row.index}</span>)}</div>
   <div className={`${styles.sheetTable} ${sheet.showGridLines?styles.gridLines:''}`} role="table" aria-label={`גיליון ${sheet.name}, לקריאה בלבד`} aria-rowcount={sheet.rowCount} aria-colcount={sheet.columnCount} style={{insetInlineStart:42,top:28,width:layout.width-42,height:layout.height-28}}>
    {sheet.rows.filter(row=>!row.hidden).map(row=><div role="row" aria-rowindex={row.index} key={row.index} className={styles.sheetRow} style={{top:layout.y[row.index-1],height:row.height,width:layout.width-42}}>{(layout.rows.get(row.index)||[]).map(cell=>{
     const width=layout.x[Math.min(sheet.columnCount,cell.column+cell.colSpan-1)]-layout.x[cell.column-1];
     const height=layout.y[Math.min(sheet.rowCount,cell.row+cell.rowSpan-1)]-layout.y[cell.row-1];
     const cellStyle={...sheet.styles[cell.styleId],...cell.styleOverride} as CSSProperties;
     const alignment=cellStyle.verticalAlign==='middle'?'center':cellStyle.verticalAlign==='top'?'flex-start':'flex-end';
     const label=`${cell.ref}${cell.formula?', הנוסחה תחושב ב־Excel':cell.status?`, ${cellStatus[cell.status]||cell.status}`:''}`;
     return <div key={cell.ref} role="cell" aria-colindex={cell.column} aria-rowspan={cell.rowSpan>1?cell.rowSpan:undefined} aria-colspan={cell.colSpan>1?cell.colSpan:undefined} aria-label={cell.formula?`${cell.ref}: ${formulaLabel}`:undefined} data-cell={cell.ref} data-origin={cell.origin} className={`${styles.cell} ${cell.formula?styles.formulaCell:''}`} title={label} style={{...cellStyle,insetInlineStart:layout.x[cell.column-1],width,height,justifyContent:alignment}}><span className={styles.cellText}>{cell.formula?<span className={styles.formulaPending} aria-label={formulaLabel}>—</span>:cell.runs?.length?cell.runs.map((run,index)=><span style={run.style as CSSProperties} key={index}>{run.text}</span>):cell.text}</span></div>;
    })}</div>)}
   </div>
   <div className={styles.drawings} style={{insetInlineStart:42,top:28,width:layout.width-42,height:layout.height-28}}>{sheet.images.map((image,index)=><img key={`${image.id}-${index}`} src={image.dataUrl} alt={image.name||'איור מתוך התבנית הרשמית'} style={{left:image.left,top:image.top,width:image.width,height:image.height}}/>)}{sheet.drawings.map((drawing,index)=><div key={index} className={styles.drawingPlaceholder} style={{left:drawing.left,top:drawing.top,width:drawing.width,height:drawing.height}}><span>{drawing.text||'Drawing available in Excel'}</span></div>)}</div>
  </div>
 </div>;
}

export function OfficialDocument({kind}:{kind:DocumentKind}){
 const [data,setData]=useState<DocumentResponse|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[authStatus,setAuthStatus]=useState(0),[requestedSheet,setRequestedSheet]=useState(''),[zoom,setZoom]=useState(1),[processing,setProcessing]=useState(false),[processingError,setProcessingError]=useState(''),[retrying,setRetrying]=useState(false),[retrySystem,setRetrySystem]=useState(''),[retryMessage,setRetryMessage]=useState(''),[now,setNow]=useState(Date.now);
 const version=useRef(0),loadController=useRef<AbortController|null>(null),retryController=useRef<AbortController|null>(null),processingRequest=useRef(false),backgroundLoad=useRef(false),loadActive=useRef(false),sheetRef=useRef(''),scrollRef=useRef<HTMLDivElement|null>(null);
 const load=useCallback(async(sheet='',background=false)=>{
  const token=++version.current;loadController.current?.abort();const controller=new AbortController();loadController.current=controller;backgroundLoad.current=background;loadActive.current=true;
  if(!background)setLoading(true);setError('');setRequestedSheet(sheet);
  try{const response=await request<DocumentResponse>(`/api/documents/${kind}${sheet?`?sheet=${encodeURIComponent(sheet)}`:''}`,{signal:controller.signal});if(token!==version.current)return;setData(response);setAuthStatus(0);sheetRef.current=response.sheetView.name;setRequestedSheet(response.sheetView.name);}
  catch(failure){if(controller.signal.aborted||token!==version.current)return;const status=(failure as {status?:number}).status||0;setError(errorText(failure));if(status===401||status===403){setAuthStatus(status);setData(null);}}
  finally{if(token===version.current){setLoading(false);backgroundLoad.current=false;loadActive.current=false;}}
 },[kind]);
 useEffect(()=>{void load();return()=>{version.current++;loadController.current?.abort();retryController.current?.abort();};},[load]);
 useEffect(()=>{if(data?.canProcess)for(const system of data.translationsSummary.systems)if(system.status!=='ready'&&system.revision>0)void scheduleLocalTranslation(system.id,system.revision);},[data]);
 useEffect(()=>{const completed=()=>void load(sheetRef.current,true);window.addEventListener('biu-translation-complete',completed);return()=>window.removeEventListener('biu-translation-complete',completed);},[load]);
 async function retryTranslations(){
  if(!data?.canProcess)return;setRetrying(true);setRetryMessage('');
  try{for(const system of data.translationsSummary.systems)if(system.status!=='ready'&&system.revision>0){setRetrySystem(system.id);await scheduleLocalTranslation(system.id,system.revision,true);}await load(sheetRef.current,true);setRetryMessage('מצב התרגום עודכן.');}
  finally{setRetrying(false);setRetrySystem('');}
 }
 function chooseSheet(name:string){if(name===data?.sheetView.name)return;scrollRef.current?.scrollTo({top:0,left:0});void load(name);}
 function tabKey(event:KeyboardEvent<HTMLButtonElement>){const list=event.currentTarget.parentElement;const tabs=Array.from(list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')||[]);const index=tabs.indexOf(event.currentTarget);let next=-1;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;if(next>=0){event.preventDefault();tabs[next]?.focus();}}
 function fitWidth(){if(!data||!scrollRef.current)return;const width=data.sheetView.columns.reduce((sum,column)=>sum+(column.hidden?0:column.width),42);setZoom(Math.max(.25,Math.min(1.5,(scrollRef.current.clientWidth-40)/width)));}
 const title=kind.toUpperCase(),summary=data?.translationsSummary,formulaCount=data?.sheetView.cells.filter(cell=>cell.formula).length||0;
 const failedSystems=summary?.systems.filter(system=>system.status!=='ready')??[],failureMessages:string[]=[],retryFailures=failedSystems,nextRetry=failedSystems.length>0,cooldown=0;
 return <div className={styles.page}>
  <a className="skip-link" href="#document-main">דילוג למסמך</a>
  <header className={styles.header}><a className={styles.brand} href="/" aria-label="BIU Racing, חזרה למערכות"><img src="/brand/biu-racing.png" alt="BIU Racing"/><span><bdi>BIU RACING</bdi><small>BAR-ILAN FORMULA</small></span></a><nav aria-label="מסמכי ענף החשמל" className={styles.documentNav}><a href="/documents/esf" aria-current={kind==='esf'?'page':undefined}>ESF</a><a href="/documents/ases" aria-current={kind==='ases'?'page':undefined}>ASES</a><a href="/documents/ses" aria-current={kind==='ses'?'page':undefined}>SES</a><a href="/" className={styles.back}>חזרה למערכות <span aria-hidden="true">↩</span></a></nav></header>
  <main id="document-main" className={styles.main}>
   <div className={styles.heading}><div><span className={styles.draftTag}>טיוטת הקבוצה · 2027</span><h1><bdi>{title}</bdi><span>מסמך <bdi>BIU Racing</bdi></span></h1></div>{data&&<div className={styles.actions}><button type="button" onClick={()=>void load(sheetRef.current)} disabled={loading}>רענון המסמך</button><a href={`/api/documents/${kind}?format=download`} className={styles.download}>הורדת <bdi>{kind==='ases'?'XLSM':'XLSX'}</bdi> <span aria-hidden="true">↓</span></a></div>}</div>
   {authStatus?<section className={styles.empty}><h2>{authStatus===401?'התחברות או הרשמה':'המסמך אינו זמין לחשבון הזה'}</h2>{authStatus===403&&<p>{error}</p>}<a className="button primary" href={`/login?returnTo=${encodeURIComponent(`/documents/${kind}`)}`}>{authStatus===401?'התחברות או הרשמה':'החלפת חשבון'}</a></section>:<>
   {error&&<div className={styles.error} role="alert"><span>{error}</span><button onClick={()=>void load(requestedSheet)}>ניסיון נוסף</button></div>}
   {!data&&loading&&<div className={styles.empty} role="status"><span className={styles.loadingDot}/><h2>פותחים את טיוטת {title}</h2><p>טוענים את מבנה הטופס ואת התשובות הזמינות באנגלית.</p></div>}
   {data&&<>
    <section className={styles.summary} aria-label="מצב המסמך"><p className={styles.templateNote}>תבנית <bdi>Italy {data.report.template.year}</bdi> לעבודה בעונת 2027. זו טיוטת BIU; תבנית הגשה רשמית ל־2027 טרם אומתה.</p><div className={styles.metrics}><span><strong>{data.report.writtenCells.length}</strong> תאים מולאו במסמך</span><span><strong>{summary?.completedFields||0} / {summary?.totalFields||0}</strong> תשובות זמינות באנגלית</span><span>הופק: <bdi>{dateLabel(data.report.generatedAt)}</bdi></span></div>{!data.scope.complete&&<p className={styles.scopeNote}>המסמך כולל רק מערכות שבתחום הגישה שלכם. תאים אחרים נשארים ללא תשובות.</p>}{summary&&!summary.providerConfigured?<p className={styles.translationNote}>התרגום מתבצע במכשיר ללא מכסת AI.</p>:summary&&summary.pendingSystems>failedSystems.length?<p className={styles.translationNote} role="status">{processing?'מעדכנים את הגרסה באנגלית…':'חלק מהתשובות עדיין ממתינות לגרסה באנגלית. תאים אלה נשארים ריקים בטיוטה.'}</p>:null}
     {failedSystems.length>0&&<div className={styles.translationRecovery} aria-label="טיפול בתרגום"><strong>האנגלית מתעדכנת במכשיר</strong>{failureMessages.map(message=><p key={message}>{message}</p>)}<p>התשובות בעברית נשמרו. אפשר להמשיך לעבוד ולהוריד את הטיוטה.</p>{data.canProcess&&retryFailures.length>0&&<div className={styles.retryActions}><button type="button" onClick={()=>void retryTranslations()} disabled={retrying||processing||loading||!nextRetry}>{retrying?'מנסים מחדש…':'ניסיון נוסף לתרגום'}</button>{Number.isFinite(cooldown)&&cooldown>now&&<span>אפשר לנסות שוב מ־<bdi>{dateLabel(new Date(cooldown).toISOString())}</bdi></span>}</div>}</div>}
     {(retrying||retryMessage)&&<p className={styles.translationNote} role="status">{retrying?<>מנסים לעדכן את האנגלית במערכת <bdi>{retrySystem||'…'}</bdi>.</>:retryMessage}</p>}
     {processingError&&<p className={styles.translationNote} role="alert">{processingError} התשובות בעברית וטיוטת האקסל נשארות זמינות.</p>}
    </section>
    <section className={styles.workbook} aria-label={`תצוגת טופס ${title}`}>
     <div className={styles.workbookTools}><div><strong dir="auto">{data.sheetView.name}</strong><small>תצוגה לקריאה בלבד</small></div><div className={styles.zoom}><button type="button" onClick={()=>setZoom(value=>Math.max(.25,Math.round((value-.1)*100)/100))} disabled={zoom<=.25} aria-label="הקטנת התצוגה">−</button><output aria-label="גודל תצוגה"><bdi>{Math.round(zoom*100)}%</bdi></output><button type="button" onClick={()=>setZoom(value=>Math.min(2,Math.round((value+.1)*100)/100))} disabled={zoom>=2} aria-label="הגדלת התצוגה">+</button><button type="button" className={styles.fit} onClick={fitWidth}>התאמה לרוחב</button></div></div>
     <div className={styles.sheetTabs} role="tablist" aria-label="גיליונות הטופס" dir="ltr">{data.sheets.map((sheet,index)=><button key={sheet.name} type="button" role="tab" id={`sheet-tab-${index}`} aria-controls="workbook-sheet" aria-selected={sheet.name===data.sheetView.name} tabIndex={sheet.name===data.sheetView.name?0:-1} onKeyDown={tabKey} onClick={()=>chooseSheet(sheet.name)} className={sheet.name===requestedSheet&&loading?styles.loadingTab:''}>{sheet.name}{sheet.state!=='visible'&&<span title="גיליון מוסתר בקובץ המקורי"> ◌</span>}</button>)}</div>
     <div className={styles.sheetViewport} ref={scrollRef} tabIndex={0} id="workbook-sheet" role="tabpanel" aria-labelledby={`sheet-tab-${data.sheets.findIndex(sheet=>sheet.name===data.sheetView.name)}`} aria-busy={loading} aria-describedby="workbook-help" dir="ltr"><WorkbookSheet sheet={data.sheetView} zoom={zoom}/>{loading&&<div className={styles.sheetLoading} role="status">טוענים גיליון…</div>}</div>
     <div className={styles.sheetFoot} id="workbook-help"><span>אפשר לגלול לרוחב ולהגדיל. עיצוב ומידות בדפדפן עשויים להשתנות מעט; הקובץ להורדה שומר את התבנית.</span>{formulaCount>0&&<span><bdi>—</bdi> נוסחה שממתינה לחישוב מחדש ב־Excel. ערכים ישנים אינם מוצגים.</span>}</div>
    </section>
    <details className={styles.details}><summary>פרטי הטיוטה והמיפוי</summary><p>התשובות בעברית נשמרות בנפרד. תרגום באנגלית מופיע במסמך רק כשהוא מתאים לגרסה השמורה. העתקת תשובה לטופס אינה אישור הנדסי.</p>{data.sheetView.drawings.length>0&&<p>תרשימים או צורות מיוחדות מסומנים במיקומם בתצוגה ונשמרים בקובץ האקסל.</p>}<p>מקור התבנית: <bdi>{data.report.template.filename}</bdi></p><a href={`/api/documents/${kind}?format=report`}>הורדת דוח המיפוי והפערים <bdi>JSON</bdi> ↓</a></details>
   </>}
   </>}
  </main>
 </div>;
}
