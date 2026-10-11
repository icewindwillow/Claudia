import {json, VERSION} from '../../server/http.mjs';
import {STREET_CONFIG} from '../../server/tiles.mjs';
export function onRequest({request,env={}}) {
  if(request.method!=='GET')return json({ok:false,message:'只支持 GET'},405);
  const config={ok:true,version:VERSION,...STREET_CONFIG};
  if(typeof env.AMAP_JS_KEY==='string'&&env.AMAP_JS_KEY.trim())config.amapKey=env.AMAP_JS_KEY.trim();
  if(typeof env.AMAP_STYLE==='string'&&env.AMAP_STYLE.trim())config.amapStyle=env.AMAP_STYLE.trim();
  if(typeof env.AMAP_JS_SECURITY_CODE==='string'&&env.AMAP_JS_SECURITY_CODE.trim())config.amapSecurityCode=env.AMAP_JS_SECURITY_CODE.trim();
  return json(config);
}
