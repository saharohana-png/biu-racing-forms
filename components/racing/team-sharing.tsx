'use client';
import {useEffect,useState} from 'react';
export function TeamSharing(){
 const [url,setUrl]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>setUrl(window.location.origin+'/'),[]);
 async function copy(){try{await navigator.clipboard.writeText(url);setMessage('הקישור הועתק. אפשר לשלוח אותו בוואטסאפ או בדיסקורד.');}catch{setMessage('אפשר להעתיק את הקישור מהשדה.');}}
 return <section style={{marginBottom:32,paddingBottom:24,borderBottom:'1px solid rgba(135,203,171,.16)'}}><div className="section-tools"><div><h2>קישור לצוות</h2><p>מזינים כתובת שמסתיימת ב־<bdi>@live.biu.ac.il</bdi> ונכנסים לעריכת מערכות החשמל, ללא סיסמה או קוד.</p></div><button className="button secondary" disabled={!url} onClick={()=>void copy()}>העתקת קישור לצוות</button></div><input className="search-input" style={{width:'100%',maxWidth:'100%'}} dir="ltr" readOnly value={url} aria-label="קישור לאתר עבור הצוות" onFocus={event=>event.currentTarget.select()}/><p className="muted">כל שינוי נשמר בהיסטוריה ומשויך להפעלת הדפדפן שביצעה אותו. כתובת המייל אינה מאומתת. שינוי בשדות שונים נשמר יחד; שינוי מקביל באותו שדה דורש בחירה בין התשובות. ניהול ההרשאות והאישורים שמור לבעלי ההרשאה המתאימה.</p>{message&&<p className="notice" role="status">{message}</p>}</section>;
}
