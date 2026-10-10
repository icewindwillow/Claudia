import {showModeration} from './guests.v0.8.js';
import {normalizeCategory,CATEGORIES,categoryOf,categoryIcon,ratingTone} from './place-style.v0.8.js';
import {project,unproject,featurePath,mergeMemories,photosOf} from './geo.v0.5.js';
import {StreetMap,readStreetConfig} from './streets.v0.4.js';
const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
let base=[],records=[],selected=null,current=null,photos=[],csrf='',busy=false,dirty=false,ready=false;
const fields={place:'place-name',placeEn:'place-en',region:'region',category:'category',lifeStatus:'life-status',locationLabel:'address',date:'trip-date',description:'description',city:'city',officialIntroduction:'official-introduction'};
let searching=false;
function searchControls(){for(const id of ['location-query','location-search-button'])$(id).disabled=!ready||busy||searching;for(const b of $('location-results').querySelectorAll('button'))b.disabled=!ready||busy||searching;}
function useResult(result,asNew){
  if(busy||searching||!ready)return;
  if(asNew){if(!leaveOK())return;createPlace();}
  else if(!confirm('将更新当前地点的位置，猫咪名字、照片与评价保持不变。继续吗？'))return;
  // Search results locate the encounter; they are not the cat's name.
  // Keep both cat-name fields untouched and only apply place metadata.
  $('address').value=result.address||result.name;
  $('region').value=result.region||'';$('city').value=result.city||'';
  $('longitude').value=result.coordinates[0];$('latitude').value=result.coordinates[1];
  current.locationPrecision='地名库参考位置 · 可在地图微调';current.coordinateSource={name:result.sourceName||'地名库参考位置',url:result.sourceUrl};
  dirty=true;drawPins();focus();$('advanced-location').open=false;
  message('已选中位置 '+result.name+'。坐标和地址已填写，请手动填写猫咪名字，再保存或发布。');
  $('place-name').scrollIntoView({block:'center',behavior:'smooth'});
}
$('location-search-form').onsubmit=async e=>{
  e.preventDefault();if(searching||busy||!ready)return;
  const query=$('location-query').value.trim();if(query.length<2)return;
  searching=true;searchControls();$('location-results').replaceChildren();$('location-search-status').textContent='正在查找地点…';
  try{
    const data=await api('/author/api/search?query='+encodeURIComponent(query));
    $('location-search-status').textContent=data.results.length?`找到 ${data.results.length} 个候选地点，请核对城市和地址。${data.upstreamQuery!==query?'（检索：'+data.upstreamQuery+'）':''}`:'没有找到。试试地点名＋重庆，或在地图上选点。';
    for(const result of data.results){
      const card=document.createElement('article');card.className='location-result';
      const title=document.createElement('strong');title.textContent=result.name;
      const address=document.createElement('p');address.textContent=result.address;
      const actions=document.createElement('div');actions.className='result-actions';
      const existing=allPlaces().find(p=>p.coordinateSource?.url===result.sourceUrl&&result.sourceUrl!=='https://www.openstreetmap.org/copyright');
      const add=document.createElement('button');add.type='button';add.textContent=existing?'打开已有地点':'选中并新增';add.onclick=()=>{if(existing){if(!busy&&leaveOK()){select(existing.id);focus();}}else useResult(result,true);};
      const use=document.createElement('button');use.type='button';use.textContent='用于当前地点';use.onclick=()=>useResult(result,false);
      actions.append(add,use);card.append(title,address,actions);$('location-results').append(card);
    }
  }catch(e){$('location-search-status').textContent=e.message;}finally{searching=false;searchControls();}
};
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('error',error);}
async function api(path,body){
  const response=await fetch(path,{cache:'no-store',credentials:'same-origin',redirect:'follow',signal:AbortSignal.timeout(45000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Atlas-CSRF':csrf},body:JSON.stringify(body)})});
  if(response.status===401||response.status===403||!/application\/(?:[\w.-]+\+)?json/i.test(response.headers.get('Content-Type')||'')){const key='claudia-access-reauth';const last=Number(sessionStorage.getItem(key)||0);if(Date.now()-last<30000){message('作者后台页面已登录，但搜索接口没有通过 Cloudflare Access。请在 Access 应用中保留目标 author/*，保存后重新打开本页。',true);throw new Error('搜索接口未通过 Cloudflare Access。');}sessionStorage.setItem(key,String(Date.now()));message('登录会话已过期，正在重新登录…',true);setTimeout(()=>{location.replace('/author/?reauth='+Date.now())},150);throw new Error('登录会话已过期，正在重新登录。');}
  sessionStorage.removeItem('claudia-access-reauth');
  const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.message||`请求失败（${response.status}）`);return data;
}
function lock(value){busy=value;$('fields').disabled=value||!ready;for(const id of ['new-place','reload','place-select'])$(id).disabled=value||!ready;$('discard').disabled=value||!records.find(r=>r.id===selected)?.draft;searchControls();}
function leaveOK(){return !dirty||confirm('当前内容尚未保存，确定切换并放弃这些修改吗？');}
function allPlaces(){return mergeMemories(base,records.filter(r=>r.draft||r.published).map(r=>r.draft||r.published));}
function options(){
  $('place-select').replaceChildren();
  for(const p of allPlaces()){const option=document.createElement('option');option.value=p.id;option.textContent=(p.place||p.title)+(records.find(r=>r.id===p.id)?.draft?' · 草稿':'');$('place-select').append(option);}
  if(current&&!allPlaces().some(p=>p.id===selected)){const option=new Option(current.place||'新地点（未保存）',selected);$('place-select').append(option);}
  $('place-select').value=selected||'';drawPins();
}
function categoryUI(){for(const button of $('category-picker').children)button.setAttribute('aria-pressed',String(button.dataset.category===categoryOf($('category').value)));}
for(const category of CATEGORIES){const button=document.createElement('button');button.type='button';button.dataset.category=category;button.append(categoryIcon(category),document.createTextNode(category));button.onclick=()=>{$('category').value=category;dirty=true;categoryUI();};$('category-picker').append(button);}
function ratingUI(){$('rating').dataset.ratingTone=$('rating-value').dataset.ratingTone=ratingTone($('unrated').checked?null:Number($('rating').value));const value=$('unrated').checked?null:Number($('rating').value);$('rating-value').textContent=value===null?'未评分':`${value.toFixed(1)} / 5 ★`;$('rating').disabled=$('unrated').checked;}
function point(){const x=$('longitude').value,y=$('latitude').value;if(x===''||y==='')return null;const c=[Number(x),Number(y)];return c.every(Number.isFinite)&&c[0]>=105.2&&c[0]<=110.3&&c[1]>=28.1&&c[1]<=32.3?c:null;}
function choosePoint(c){if(!ready||busy)return;if(c[0]<105.2||c[0]>110.3||c[1]<28.1||c[1]>32.3){$('map-status').textContent='请选择重庆范围内的位置。';return;} $('longitude').value=c[0].toFixed(6);$('latitude').value=c[1].toFixed(6);dirty=true;current.locationPrecision='作者地图选点';delete current.coordinateSource;drawPins();$('map-status').textContent=`已选定：经度 ${c[0].toFixed(6)}，纬度 ${c[1].toFixed(6)}。保存或发布后才会更新。`;}
function select(id,newPlace=null){
  selected=id;const row=records.find(r=>r.id===id);current=structuredClone(newPlace||row?.draft||row?.published||base.find(p=>p.id===id));
  if(!current)return;current=normalizeCategory(current);photos=structuredClone(photosOf(current));
  for(const [key,field]of Object.entries(fields))$(field).value=(key==='category'&&!CATEGORIES.includes(current.category)?'':current[key])|| (key==='region'?'chongqing':key==='category'?'':'');categoryUI();
  $('longitude').value=current.coordinates?.[0]??'';$('latitude').value=current.coordinates?.[1]??'';
  $('review-author').value=current.review?.author||'竹喵';$('return-dates').value=(current.visitDates||[]).filter(d=>d!==current.date).join(', ');$('comment').value=current.review?.comment||'';
  $('unrated').checked=current.review?.rating==null;$('rating').value=current.review?.rating??5;ratingUI();
  reviewCounts();dirty=false;options();renderPhotos();lock(false);showModeration(id,api);
  const published=row?.published||base.find(p=>p.id===id);
  $('record-status').textContent=row?.draft?'有云端草稿 · 公开版本保持不变':published?'已发布 · 正在编辑副本':'新地点 · 尚未发布';
  $('published-summary').textContent=published?`${published.place} · ${published.review?.rating==null?'未评分':published.review.rating+' 星'}\n${published.review?.comment||''}`:'保存草稿仅作者可见；发布后才会出现在公开地图。';
  $('public-link').hidden=!published;$('public-link').href=`/#place=${encodeURIComponent(id)}`;
  if(street&&point())street.flyTo({center:point(),zoom:14});drawPins();
}
function draft(){
  const m={...current,id:selected,photos:structuredClone(photos),coordinates:point()};
  for(const [key,field]of Object.entries(fields))m[key]=$(field).value;
  if(!m.title||m.title===current.place)m.title=m.place;
  m.review={author:$('review-author').value,rating:$('unrated').checked?null:Number($('rating').value),comment:$('comment').value};
  m.visitDates=[...new Set([m.date,...$('return-dates').value.split(/[,，\s]+/)].filter(Boolean))];
  return m;
}
async function load(){
  lock(true);
  try{
    const session=await api('/author/api/session');csrf=session.csrf;
    const [seed,saved,cloud]=await Promise.all([api('/data/starter.json'),api('/data/memories.json?v=0.7'),api('/author/api/places')]);
    base=mergeMemories(seed.memories,saved.memories).map(p=>p.id===session.record.id?{...p,review:session.record.review}:p);records=cloud.records;
    // Preserve unpublished reviews created with the v0.4 editor until deliberately saved/published here.
    const legacy=session.record;
    if(legacy.hasDraft&&!records.some(r=>r.id===legacy.id)){const p=base.find(p=>p.id===legacy.id);if(p)records.push({id:legacy.id,published:p,draft:{...p,review:legacy.draft},revision:0,legacyRevision:legacy.revision});}
    ready=true;$('identity-label').textContent=session.author.email;
    const requested=new URL(location.href).searchParams.get('place');
    const id=[selected,requested,allPlaces()[0]?.id].find(id=>allPlaces().some(p=>p.id===id));
    if(id)select(id);else createPlace();
    message('已连接云端。可以新增地点、在地图上选点，并保存草稿或发布。');
  }catch(e){message(e.message,true);}finally{lock(false);}
}
function createPlace(){select('place-'+crypto.randomUUID(),{place:'',title:'',region:'chongqing',coordinates:null,photos:[],review:{author:'竹喵',rating:null,comment:''}});dirty=true;$('location-query').focus();message('请先搜索地名并选择候选地点，位置会自动填写。');}
async function save(action){
  if(busy||!ready)return;
  if(action!=='discard-draft'&&!point()){message('请先搜索并选择地点，或在地图上点选位置。',true);$('location-query').focus();return;}
  if(action!=='discard-draft'&&!$('place-form').reportValidity())return;
  const row=records.find(r=>r.id===selected);const content=draft();lock(true);message('正在保存到云端，请稍等…');
  try{
    if(action==='discard-draft'&&row?.legacyRevision){await api('/author/api/review',{id:selected,revision:row.legacyRevision,action});records=records.filter(r=>r.id!==selected);select(selected);message('旧版云端草稿已丢弃，公开评价保持不变。');return;}
    const data=await api('/author/api/place',{id:selected,revision:row?.revision||0,action,place:content});
    records=records.filter(r=>r.id!==selected);records.push(data.record);
    // Empty discarded new drafts remain a private tombstone for concurrency safety.
    select(selected,data.record.draft||data.record.published||base.find(p=>p.id===selected)||content);
    dirty=!data.record.draft&&!data.record.published&&!base.some(p=>p.id===selected);
    message(action==='publish'?'已发布！公开地图会显示这个地点、照片及评分。':action==='draft'?'云端草稿已保存，公开地图未改变。':'云端草稿已丢弃。');
  }catch(e){message(e.message+' 当前输入已保留。',true);}finally{lock(false);ratingUI();}
}
function previewSrc(src){return src.startsWith('/api/photos/')?'/author/api/photo?id='+encodeURIComponent(src.split('/').at(-1)):src.replace(/^\.\//,'/');}
function renderPhotos(){
  $('photo-list').replaceChildren();photos.forEach((photo,i)=>{
    const card=document.createElement('div');card.className='photo-item';
    const image=new Image();image.src=previewSrc(photo.src);image.alt=photo.alt||`第 ${i+1} 张照片`;card.append(image);
    const caption=document.createElement('input');caption.value=photo.caption||'';caption.maxLength=500;caption.placeholder='照片说明';caption.setAttribute('aria-label',`第 ${i+1} 张照片说明`);caption.addEventListener('input',()=>{photo.caption=caption.value;dirty=true;});card.append(caption);
    const actions=document.createElement('div');actions.className='photo-actions';
    const move=document.createElement('button');move.type='button';move.textContent=i===0?'封面照片':'设为封面';move.disabled=i===0;move.onclick=()=>{photos.splice(i,1);photos.unshift(photo);dirty=true;renderPhotos();};
    const remove=document.createElement('button');remove.type='button';remove.textContent='移出相册';remove.onclick=()=>{photos.splice(i,1);dirty=true;renderPhotos();};actions.append(move,remove);card.append(actions);$('photo-list').append(card);
  });
}
async function compress(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>25*1024*1024)throw new Error('请选择 25 MB 以内的 JPEG、PNG 或 WebP 图片。');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;await image.decode();
    const scale=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [.82,.7,.55,.4,.25,.15]){const data=canvas.toDataURL('image/jpeg',quality);if(atob(data.split(',')[1]).length<=200*1024)return {data,width:canvas.width,height:canvas.height};}
    throw new Error('这张照片压缩后仍过大，请先缩小图片再上传。');
  }finally{URL.revokeObjectURL(url);}
}
// Read GPS before canvas compression (canvas intentionally removes EXIF metadata).
async function readPhotoGps(file){
  if(file.type!=='image/jpeg')return null;
  const buf=await file.arrayBuffer(),view=new DataView(buf);
  if(view.getUint16(0)!==0xffd8)return null;
  let p=2;
  while(p+4<view.byteLength){
    if(view.getUint8(p)!==0xff){p++;continue;}
    const marker=view.getUint8(p+1);p+=2;
    if(marker===0xda||marker===0xd9)break;
    const len=view.getUint16(p);if(marker===0xe1&&view.getUint32(p+2)===0x45786966&&view.getUint16(p+6)===0){
      const t=p+10,little=view.getUint16(t)===0x4949, u16=(o)=>view.getUint16(t+o,little),u32=(o)=>view.getUint32(t+o,little);
      const ifd=t+u32(4),n=u16(ifd),tags={};
      for(let i=0;i<n;i++){const q=ifd+2+i*12;tags[u16(q)]=q;}
      const gps=tags[0x8825];if(!gps)return null;const go=t+u32(gps+8),gn=u16(go),g={};
      for(let i=0;i<gn;i++){const q=go+2+i*12;g[u16(q)]=q;}
      const text=(q)=>String.fromCharCode(...new Uint8Array(buf,t+u32(q+8),Math.max(0,u32(q+4)-1)));
      const rat=(q)=>{const o=t+u32(q+8);return view.getUint32(o,little)/view.getUint32(o+4,little)};
      if(!g[1]||!g[2]||!g[3]||!g[4])return null;
      const o=t+u32(g[2]+8),v=[rat(o),rat(o+8),rat(o+16)];let lat=v[0]+v[1]/60+v[2]/3600;
      const oo=t+u32(g[4]+8),w=[rat(oo),rat(oo+8),rat(oo+16)];let lon=w[0]+w[1]/60+w[2]/3600;
      if(text(g[1])==='S')lat=-lat;if(text(g[3])==='W')lon=-lon;
      return [lon,lat];
    }
    p+=len;
  }return null;
}
function distanceMeters(a,b){const r=Math.PI/180,lat=(a[1]+b[1])/2*r;return Math.hypot((a[0]-b[0])*Math.cos(lat)*111320,(a[1]-b[1])*110540);}
let pendingPhotoGroups=[];
function renderPhotoSeries(groups){const box=$('photo-series'),list=$('photo-series-list');if(!groups.length){box.hidden=true;return;}pendingPhotoGroups=groups;box.hidden=false;list.replaceChildren();groups.forEach((g,i)=>{const row=document.createElement('div');row.className='photo-series-row';const name=document.createElement('input');name.value=g.name=g.gps?`重庆 · 地点系列 ${String(i+1).padStart(2,'0')}`:'未定位照片 · 待补充地点';name.setAttribute('aria-label',`第 ${i+1} 个系列名称`);name.oninput=()=>g.name=name.value;const meta=document.createElement('small');meta.textContent=`${g.files.length} 张照片${g.gps?` · ${g.gps[1].toFixed(5)}，${g.gps[0].toFixed(5)}`:' · 无 GPS'}`;row.append(name,meta);list.append(row);});}
async function uploadPhotoGroups(){if(!pendingPhotoGroups.length||busy)return;const groups=pendingPhotoGroups;pendingPhotoGroups=[];lock(true);try{let index=0;for(const group of groups){for(const file of group.files){index++;message(`正在上传第 ${index} 张照片…`);const p=await compress(file),result=await api('/author/api/photo',{data:p.data});photos.push({...result.photo,width:p.width,height:p.height,caption:'',alt:''});}if(group===groups[0]&&group.gps){const [lon,lat]=group.gps;$('longitude').value=lon.toFixed(6);$('latitude').value=lat.toFixed(6);$('region').value='chongqing';$('city').value='重庆市';$('address').value=`${group.name} · 照片 GPS`;current.locationPrecision='照片 EXIF GPS';current.coordinateSource={name:'照片 EXIF GPS'};dirty=true;drawPins();}}renderPhotos();$('photo-series').hidden=true;message(`照片已上传，已整理为 ${groups.length} 个系列。系列名称已保留在本次清单中，请核对地点后保存。`);}catch(e){message(e.message+' 已完成的照片保留在当前相册。',true);}finally{lock(false);ratingUI();}}
$('photos').addEventListener('change',async e=>{
  const files=[...e.target.files];e.target.value='';if(!files.length||busy)return;
  if(photos.length+files.length>15){message('每个地点最多 15 张照片，请减少本次选择的数量。',true);return;}
  try{const groups=[];for(let i=0;i<files.length;i++){message(`正在读取照片 ${i+1}/${files.length}…`);const gps=await readPhotoGps(files[i]);const valid=gps&&gps[0]>=105.2&&gps[0]<=110.3&&gps[1]>=28.1&&gps[1]<=32.3;let group=valid&&groups.find(g=>g.gps&&distanceMeters(g.gps,gps)<=500);if(!group){group={gps:valid?gps:null,files:[]};groups.push(group);}group.files.push(files[i]);}renderPhotoSeries(groups);}catch(e){message(e.message,true);}
});
$('confirm-photo-series').onclick=uploadPhotoGroups;
$('place-form').addEventListener('input',()=>{dirty=true;ratingUI();categoryUI();reviewCounts();drawPins();});
for(const id of ['longitude','latitude'])$(id).addEventListener('input',()=>{current.locationPrecision='作者填写坐标';delete current.coordinateSource;});
$('place-select').addEventListener('change',e=>{if(leaveOK())select(e.target.value);else e.target.value=selected;});
$('new-place').onclick=()=>{if(!busy&&leaveOK())createPlace();};$('reload').onclick=()=>{if(!busy&&leaveOK())load();};
$('place-form').onsubmit=e=>{e.preventDefault();save('publish');};$('save-draft').onclick=()=>save('draft');
$('discard').onclick=()=>{if(confirm('丢弃这个地点的云端草稿及当前未保存修改？已发布版本不会改变。'))save('discard-draft');};
$('backup').onclick=()=>{if(!current)return;const blob=new Blob([JSON.stringify(draft(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${selected}-backup.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});

// Always-available coastline overview; street tiles are optional and have their own failure state.
let view={x:105.2,y:project([0,32.3])[1],w:5.1,h:project([0,28.1])[1]-project([0,32.3])[1]},street=null,modeToken=0;
function renderMap(){$('overview').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);drawPins();}
function drawPins(){
  $('selected-location').textContent=point()?`已定位：${$('place-name').value||'地图选点'} · ${$('address').value||'可在地图上微调'}`:'请先搜索并选择地点，也可以在地图上点选。';
  const c=point();$('current-pin').toggleAttribute('hidden',!c||!!street);$('street-pin').hidden=!c||!street;
  const unit=1/($('overview').getScreenCTM()?.a||25);
  if(c){const p=project(c);$('current-pin').setAttribute('cx',p[0]);$('current-pin').setAttribute('cy',p[1]);$('current-pin').setAttribute('r',6*unit);$('current-pin').style.strokeWidth=2*unit;if(street){const s=street.project(c);$('street-pin').style.left=s.x+'px';$('street-pin').style.top=s.y+'px';}}
  $('other-pins').replaceChildren();for(const p of allPlaces()){if(p.id===selected||!p.coordinates)continue;const circle=document.createElementNS(NS,'circle'),c=project(p.coordinates);circle.setAttribute('cx',c[0]);circle.setAttribute('cy',c[1]);circle.setAttribute('r',view.w*.007);const title=document.createElementNS(NS,'title');title.textContent=p.place;circle.append(title);$('other-pins').append(circle);}
}
function svgPosition(e){const p=new DOMPoint(e.clientX,e.clientY);return p.matrixTransform($('overview').getScreenCTM().inverse());}
function zoom(factor){if(street){street.zoomBy(Math.log2(factor));return;}const w=Math.max(.025,Math.min(26,view.w/factor)),ratio=w/view.w;view={x:view.x+(view.w-w)/2,y:view.y+view.h*(1-ratio)/2,w,h:view.h*ratio};renderMap();}
function focus(){const c=point();if(!c){message('先点击地图，或填写经纬度。',true);return;}if(street)street.flyTo({center:c,zoom:15});else{const p=project(c);view={x:p[0]-.04,y:p[1]-.05,w:.08,h:.1};renderMap();}}
let drag=null;
$('overview').addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=svgPosition(e);drag={id:e.pointerId,x:e.clientX,y:e.clientY,last:p,moved:false};$('overview').setPointerCapture(e.pointerId);});
$('overview').addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;const p=svgPosition(e);if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6)drag.moved=true;if(drag.moved){view.x-=p.x-drag.last.x;view.y-=p.y-drag.last.y;renderMap();drag.last=svgPosition(e);}});
$('overview').addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;if(!drag.moved){const p=svgPosition(e);choosePoint(unproject([p.x,p.y]));}drag=null;});
$('overview').addEventListener('pointercancel',()=>drag=null);
$('overview').addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-Math.max(-100,Math.min(100,e.deltaY))*.004));},{passive:false});
$('picker').addEventListener('keydown',e=>{if(street)return;if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?1/1.5:1.5);}const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(d){e.preventDefault();view.x+=d[0]*view.w*.1;view.y+=d[1]*view.h*.1;renderMap();}});
$('zoom-in').onclick=()=>zoom(1.7);$('zoom-out').onclick=()=>zoom(1/1.7);$('focus-pin').onclick=focus;
$('map-reset').onclick=()=>{if(street)street.flyTo({center:[106.55,29.56],zoom:11});else{view={x:105.2,y:project([0,32.3])[1],w:5.1,h:project([0,28.1])[1]-project([0,32.3])[1]};renderMap();}};
$('center-pin').onclick=()=>choosePoint(street?[street.getCenter().lng,street.getCenter().lat]:unproject([view.x+view.w/2,view.y+view.h/2]));
function overview(){++modeToken;if(street){street.remove();street=null;}$('street').hidden=true;$('overview').removeAttribute('hidden');$('attribution').hidden=true;$('overview-mode').setAttribute('aria-pressed','true');$('street-mode').setAttribute('aria-pressed','false');$('street-mode').disabled=false;renderMap();}
$('overview-mode').onclick=overview;
$('street-mode').onclick=async()=>{
  if(street){street.retry();return;}const token=++modeToken;$('street-mode').disabled=true;$('map-status').textContent='正在加载街道底图…';
  try{const config=await readStreetConfig();if(token!==modeToken)return;$('street').hidden=false;
    street=new StreetMap({container:$('street'),center:point()||[106.55,29.56],zoom:point()?14:11,config,onStatus:s=>{$('map-status').textContent=s.failed?'部分街道图片未加载，可再次点击“街道底图”重试，或切回总览。':'点击街道地图设置坐标；拖动与缩放不会改变已选位置。';}});
    const m=street;let start=null;
    $('street').addEventListener('pointerdown',e=>{if(m.pointers.size>1){start=null;return;}start={x:e.clientX,y:e.clientY,moved:false};},{signal:m.life.signal});
    $('street').addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)start.moved=true;},{signal:m.life.signal});
    $('street').addEventListener('pointerup',e=>{if(start&&!start.moved){const r=$('street').getBoundingClientRect();choosePoint(m.unproject([e.clientX-r.left,e.clientY-r.top]));}start=null;},{signal:m.life.signal});
    $('street').addEventListener('pointercancel',()=>start=null,{signal:m.life.signal});m.on('move',drawPins);m.on('resize',drawPins);
    await m.waitForReady();if(token!==modeToken)return;$('overview').setAttribute('hidden','');$('attribution').hidden=false;$('overview-mode').setAttribute('aria-pressed','false');$('street-mode').setAttribute('aria-pressed','true');drawPins();
  }catch(e){if(token!==modeToken)return;overview();$('map-status').textContent=e.message+' 已保留总览地图，可继续选点。';}finally{if(token===modeToken)$('street-mode').disabled=false;}
};
new ResizeObserver(()=>{street?.resize();drawPins();}).observe($('picker'));
async function geography(){try{const data=await api('/data/chongqing-overview.geojson');for(const f of data.features){const path=document.createElementNS(NS,'path');path.setAttribute('d',featurePath(f));path.setAttribute('class',`coast-${f.properties.kind}`);$('coast').append(path);}}catch(e){$('map-status').textContent='总览加载失败，请尝试街道底图或填写经纬度。';}}
renderMap();geography();load();

function reviewCounts(){$('short-count').textContent=`${$('comment').value.length} 字 · 建议 60 字以内（已有长文字仍可保留）`;$('long-count').textContent=`${$('description').value.length} / 10000 字`;}
