'use client';
import {useRef,useState} from 'react';
import {request} from '@/lib/client-types';

/** Separate retained owner access. Team entry never uses this flow. */
export default function AdminLogin(){
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const busy=useRef(false);
 async function enter(){
  if(busy.current)return;busy.current=true;setPending(true);setError('');
  try{await request('/api/auth/logout',{method:'POST'});window.location.assign('/');}
  catch{setError('הכניסה לא הושלמה. אפשר לנסות שוב.');busy.current=false;setPending(false);}
 }
 return <div className="site-shell command-mode"><main className="main"><section className="access-panel"><h1>כניסת מנהל</h1><p>כניסת מנהל באמצעות Cloudflare Access של הקבוצה. הרשאת רכז ניתנת רק לחשבון שהוגדר במסד הנתונים.</p>{error&&<p className="notice error-notice" role="alert">{error}</p>}<div className="login-actions"><button type="button" className="button primary" disabled={pending} onClick={()=>void enter()}>{pending?'פותחים…':'כניסה לניהול'}</button><a className="button secondary" href="/login">כניסת צוות</a></div></section></main></div>;
}
