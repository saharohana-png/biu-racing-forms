import 'server-only';
import {timingSafeEqual} from 'node:crypto';
/** University email alone is self-declared; a private team code grants workspace access. */
export function teamEntryAllowed(value:unknown){
 const expected=process.env.FORMS_TEAM_CODE;
 if(!expected||typeof value!=='string'||!value||Buffer.byteLength(value)!==Buffer.byteLength(expected))return false;
 return timingSafeEqual(Buffer.from(value),Buffer.from(expected));
}
