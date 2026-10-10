import {visitorList,deleteVisitor} from '../../server/visitors.mjs';
import {json,errorResponse,HttpError,canonicalOrigin,SECURITY_HEADERS,limitedJson} from '../../server/http.mjs';
import {requireAuthor,requireWrite,csrfFor} from '../../server/auth.mjs';
import {getAuthorRecord,mutateReview} from '../../server/reviews.mjs';
import {listPlaces,mutatePlace,uploadPhoto,readPhoto} from '../../server/places.mjs';
import {searchPlaces} from '../../server/search.mjs';
function gatePage(error) {
  const safe=String(error instanceof HttpError ? error.message : '作者后台暂时不可用，请稍后重试。').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>作者入口 · 竹喵的撸猫地图</title><link rel="stylesheet" href="/assets/author.v0.4.css"><main class="gate-card"><span class="kicker">THE AUTHOR’S DESK</span><h1>作者入口</h1><p>${safe}</p><p>配置完成后，这里由 Cloudflare Access 验证作者邮箱。作者内容仅允许已验证且在允许名单中的作者修改。</p><a class="button" href="/">返回公开地图</a><a href="/api/health">查看配置检查</a></main></html>`,{status:error instanceof HttpError ? error.status : 500,headers:{...SECURITY_HEADERS,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store'}});
}
export async function onRequest(context) {
  const {request,env}=context,url=new URL(request.url);
  const page=['/author','/author/','/author/index.html'].includes(url.pathname);
  try {
    const canonical=canonicalOrigin(env);
    if(url.origin!==canonical){
      if(page && request.method==='GET')return new Response(null,{status:302,headers:{Location:`${canonical}/author/`,'Cache-Control':'no-store'}});
      throw new HttpError(403,'AUTHOR_ORIGIN_ONLY','请使用指定的作者后台域名。');
    }
    const author=await requireAuthor(request,env);
    if(url.pathname==='/author/api/guest-reviews'&&request.method==='GET')return json({ok:true,...await visitorList(env,url.searchParams.get('place'),url.searchParams.get('before')||'')});
    if(url.pathname==='/author/api/guest-review/delete'&&request.method==='POST'){await requireWrite(request,env);return json({ok:true,...await deleteVisitor(env,await limitedJson(request,2048),author)});}

    if(url.pathname==='/author/api/search' && (request.method==='GET'||request.method==='POST')) {
      await requireWrite(request,env);
      const body=request.method==='GET'?{query:url.searchParams.get('query')||''}:await limitedJson(request,2048);
      return json({ok:true,...await searchPlaces(env,body)});
    }
    if(url.pathname==='/author/api/places' && request.method==='GET')return json({ok:true,records:await listPlaces(env,true)});
    if(url.pathname==='/author/api/photo' && request.method==='GET')return await readPhoto(env,url.searchParams.get('id'),true);
    if(['/author/api/place','/author/api/photo'].includes(url.pathname) && request.method==='POST') {
      await requireWrite(request,env);
      const body=await limitedJson(request,url.pathname.endsWith('/photo')?280*1024:128*1024);
      return json(url.pathname.endsWith('/photo')?{ok:true,photo:await uploadPhoto(env,body)}:{ok:true,record:await mutatePlace(env,body,author)});
    }
    if(page && request.method==='GET') {
      if(url.pathname==='/author')return new Response(null,{status:302,headers:{Location:'/author/','Cache-Control':'no-store'}});
      // Fetch the directory URL: Pages may redirect /author/index.html to /author/.
      const asset=await env.ASSETS.fetch(new Request(`${url.origin}/author/`));
      if(!asset.ok)throw new HttpError(503,'AUTHOR_ASSET_MISSING','作者页面文件未正确部署。请检查 public/author/index.html。');
      return new Response(asset.body,{status:asset.status,headers:{...SECURITY_HEADERS,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store'}});
    }
    if(url.pathname==='/author/api/session' && request.method==='GET')
      return json({ok:true,author,csrf:await csrfFor(request.headers.get('Cf-Access-Jwt-Assertion')),record:await getAuthorRecord(env)});
    if(url.pathname==='/author/api/review' && request.method==='POST') {
      await requireWrite(request,env);
      const body=await limitedJson(request);
      return json({ok:true,action:body.action,record:await mutateReview(env,body,author)});
    }
    throw new HttpError(404,'NOT_FOUND','未找到这个作者接口。');
  }catch(error){return page?gatePage(error):errorResponse(error);}
}
