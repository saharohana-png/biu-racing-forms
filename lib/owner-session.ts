import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
export const OWNER_COOKIE='biu_owner_session';
export function ownerKeyMatches(value:unknown){
 const configured=process.env.FORMS_OWNER_KEY;
 if(!configured||typeof value!=='string'||!/^[a-f0-9]{48}$/.test(value)||value.length!==configured.length)return false;
 return timingSafeEqual(Buffer.from(value),Buffer.from(configured));
}
function signature(value:string){const key=process.env.FORMS_SESSION_KEY;if(!key)throw Error('Owner sessions are not configured');return createHmac('sha256',key).update(value).digest('hex');}
export function ownerToken(){const expires=String(Date.now()+14*86400000);return expires+'.'+signature(expires);}
export function validOwnerToken(token:string|undefined){
 if(!token||!/^\d{13}\.[a-f0-9]{64}$/.test(token))return false;
 const [expires,sig]=token.split('.');
 return Number(expires)>Date.now()&&timingSafeEqual(Buffer.from(sig),Buffer.from(signature(expires)));
}
