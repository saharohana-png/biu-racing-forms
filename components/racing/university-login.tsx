'use client';
import {useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {request} from '@/lib/client-types';
import type {Session} from '@/lib/client-types';

/** Only return to a site workspace, never an external URL or an authentication endpoint. */
export function safeLoginReturnTo(value:string|null|undefined){
 if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020]/.test(value))return '/';
 try{
  const decoded=decodeURIComponent(value);
  if(decoded.startsWith('//')||/[\\\u0000-\u0020]/.test(decoded))return '/';
  const url=new URL(value,'https://biu.invalid');
  return url.origin==='https://biu.invalid'&&/^\/(?:documents\/(?:esf|ases))?$/.test(url.pathname)?`${url.pathname}${url.search}${url.hash}`:'/';
 }catch{return '/';}
}

export function UniversityLogin({error,onSuccess,onRetry}:{error?:string;onSuccess?:(session:Session)=>void|Promise<void>;onRetry?:()=>void}){
 const [email,setEmail]=useState(''),[pending,setPending]=useState(false),[failure,setFailure]=useState('');
 const submitting=useRef(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(submitting.current)return;
  const normalized=email.trim().toLowerCase();
  if(!/^[^\s@]+@live\.biu\.ac\.il$/.test(normalized)){setFailure('יש להזין כתובת מייל עם הסיומת ‎@live.biu.ac.il‎.');return;}
  submitting.current=true;setPending(true);setFailure('');
  try{
   const session=await request<Session>('/api/auth/email-entry',{method:'POST',body:JSON.stringify({email:normalized})});
   if(onSuccess)await onSuccess(session);
   else window.location.assign(safeLoginReturnTo(new URLSearchParams(window.location.search).get('returnTo')));
  }catch(reason){
   const problem=reason as {status?:number;message?:string};
   setFailure(problem.status&&[400,403,429].includes(problem.status)&&problem.message?problem.message:'הכניסה לא הושלמה. אפשר לנסות שוב.');
  }finally{submitting.current=false;setPending(false);}
 }
 const message=failure||error;
 return <><h1>התחברות או הרשמה</h1><form className="email-entry-form" onSubmit={submit} noValidate aria-busy={pending}>
  <label htmlFor="team-email">מייל אוניברסיטאי</label>
  <input id="team-email" name="email" type="email" inputMode="email" dir="ltr" placeholder="name@live.biu.ac.il" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required value={email} disabled={pending} aria-invalid={!!failure} aria-describedby={message?'email-entry-error':undefined} onChange={event=>{setEmail(event.target.value);setFailure('');}}/>
  {message&&<p id="email-entry-error" className="notice error-notice" role="alert">{message}</p>}
  <div className="login-actions"><button className="button primary" type="submit" disabled={pending}>{pending?'נכנסים…':'כניסה'}</button>{error&&onRetry&&<button className="button secondary" type="button" disabled={pending} onClick={onRetry}>ניסיון נוסף</button>}</div>
 </form></>;
}
