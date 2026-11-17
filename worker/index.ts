import handler from 'vinext/server/fetch-handler';
import {verifyAccessIdentity} from '../lib/access-identity';
export default { async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
  if(env.LOCAL_DEV!=='true'){
    const identity=await verifyAccessIdentity(request.headers.get('cf-access-jwt-assertion'),{teamDomain:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUD});
    if(!identity)return new Response('This deployment requires Cloudflare Access authentication.',{status:403,headers:{'Cache-Control':'no-store'}});
  }
  return handler.fetch(request, env, ctx);
}};
