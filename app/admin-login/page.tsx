"use client";
import {useState} from 'react';
import {request} from '@/lib/client-types';
export default function AdminLogin(){
 const [key,setKey]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 async function enter(event:React.FormEvent){event.preventDefault();if(pending)return;setPending(true);setError('');try{await request('/api/auth/owner',{method:'POST',body:JSON.stringify({key})});window.location.assign('/');}catch{setError('מפתח הניהול אינו נכון או שהחיבור לא זמין.');setPending(false);}}
 return <div className="site-shell command-mode"><main className="main"><section className="access-panel"><h1>כניסת מנהל</h1><p>הזנת מפתח הניהול האישי של בעל הפרויקט.</p><form onSubmit={enter}><label>מפתח ניהול<input type="password" autoComplete="current-password" value={key} onChange={e=>setKey(e.target.value)} required dir="ltr"/></label>{error&&<p role="alert" className="notice error-notice">{error}</p>}<div className="login-actions"><button className="button primary" disabled={pending}>{pending?'נכנסים…':'כניסה לניהול'}</button><a className="button secondary" href="/login">כניסת צוות</a></div></form></section></main></div>;
}
