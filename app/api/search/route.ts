import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Listing={id:string;title:string;address:string;district:string;area:number|null;rent:number|null;community:number|null;ibi:number|null;url:string;source:string;status:string;checkedAt:string};
const sources=[{name:'Belbex',domain:'belbex.com'},{name:'LoopNet',domain:'loopnet.es'},{name:'JLL',domain:'jll.es'},{name:'CBRE',domain:'cbre.es'},{name:'Savills',domain:'savills.es'},{name:'Cushman & Wakefield',domain:'cushmanwakefield.com'}];
const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function numberMatch(text:string,patterns:RegExp[]):number|null{for(const re of patterns){const m=text.match(re);if(m){const v=Number(m[1].replace(/\./g,'').replace(',','.'));if(Number.isFinite(v)&&v>0)return v;}}return null;}
function parsePage(html:string,url:string,source:string):Listing|null{
 const text=clean(html);
 const title=clean((html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)||[])[1]||'');
 if(!/(alquiler|rent)/i.test(title)||/(venta|sale)/i.test(title)||!/(oficina|office)/i.test(title)||/(coworking|centro de negocios|puesto de trabajo|por puesto)/i.test(title))return null;
 const area=numberMatch(text,[/(?:superficie|área|area|surface)[^\d]{0,35}(\d[\d.]*[,]?\d*)\s*m(?:2|²)/i,/(\d[\d.]*[,]?\d*)\s*m(?:2|²)/i]);
 const rent=numberMatch(text,[/(\d[\d.]*[,]?\d*)\s*€\s*\/\s*m(?:2|²)\s*\/\s*(?:mes|month)/i,/(?:renta|alquiler|rent)[^\d]{0,40}(\d[\d.]*[,]?\d*)\s*€/i]);
 const address=clean((html.match(/(?:address|streetAddress)[^>:"']{0,20}["']([^"']{8,120})["']/i)||[])[1]||'Madrid capital · dirección por confirmar');
 if(!area||!rent)return null;
 return {id:url,title,address,district:'Madrid capital',area,rent,community:null,ibi:null,url,source,status:'Renta y superficie detectadas · gastos pendientes',checkedAt:new Date().toISOString().slice(0,10)};
}
function unwrap(href:string){try{const u=new URL(href,'https://duckduckgo.com');return u.searchParams.get('uddg')||u.href;}catch{return href;}}
export async function GET(req:Request){
 const {searchParams}=new URL(req.url);const q=(searchParams.get('q')||'').trim().slice(0,80);
 const listings:Listing[]=[];const seen=new Set<string>();
 for(const src of sources){
  const query=encodeURIComponent('oficinas en alquiler '+q+' Madrid site:'+src.domain+' -venta -coworking');
  try{
   const res=await fetch('https://html.duckduckgo.com/html/?q='+query,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MadridOfficeMarket/2.0)'},signal:AbortSignal.timeout(9000),cache:'no-store'});
   if(!res.ok)continue;const html=await res.text();
   const links=[...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({url:unwrap(m[1]),title:clean(m[2])}));
   for(const link of links.slice(0,5)){
    if(!link.url.startsWith('http')||seen.has(link.url)||!link.url.includes(src.domain))continue;seen.add(link.url);
    try{const page=await fetch(link.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; MadridOfficeMarket/2.0)'},signal:AbortSignal.timeout(7000),redirect:'follow',cache:'no-store'});if(!page.ok)continue;const body=await page.text();const item=parsePage(body,page.url,src.name);if(item)listings.push(item);}catch{}
   }
  }catch{}
 }
 const unique=listings.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,30);
 return NextResponse.json({listings:unique,message:unique.length?'Fichas detectadas con renta y superficie. Los gastos no publicados quedan pendientes.':'No se han podido extraer fichas verificables en esta ejecución. Los portales pueden limitar consultas automatizadas; prueba otra zona o añade anuncios manualmente.',sources:sources.map(s=>s.name)},{headers:{'Cache-Control':'no-store'}});
}
