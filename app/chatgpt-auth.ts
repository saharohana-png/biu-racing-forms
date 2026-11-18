/** Legacy import name only. Owner access is independent of ChatGPT. */
import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {OWNER_COOKIE,validOwnerToken} from '@/lib/owner-session';
export type ChatGPTUser={userId:string;displayName:string;email:string;fullName:string|null};
export async function getChatGPTUser():Promise<ChatGPTUser|null>{
 const token=(await cookies()).get(OWNER_COOKIE)?.value;
 if(!validOwnerToken(token))return null;
 return {userId:'owner:sahar',displayName:'סהר',email:'',fullName:null};
}
export async function requireChatGPTUser(returnTo:string){const user=await getChatGPTUser();if(user)return user;redirect(chatGPTSignInPath(returnTo));}
export function chatGPTSignInPath(_returnTo:string){return '/admin-login';}
export function chatGPTSignOutPath(_returnTo='/'){return '/login';}
