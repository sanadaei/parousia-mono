const FIELDS={sfLat:[-90,90],sfLon:[-180,180],sfTransition:[100,20000],sfElevation:[-1000000,1000000],sfZoom:[.6,16],sfAltitude:[3,40000000]};
const VERSIONS={sfChannelVersion:'shape-first-designed-channels@2',sfRuntimeVersion:'shape-first-sphere@2'};
const STRINGS=['sfParentWorld','sfChannelVersion','sfRuntimeVersion','sfOutletIdentity','sfLevel','sfView','sfSymbols'];
export function validateShapeFirstView(view) {
  if(view===undefined)return undefined;
  if(!view||view.schema!=='shape-first-view@1'||!['shape-first','shape-first-inspect'].includes(view.terrain))throw new Error('形状ビューの保存形式が一致しません');
  if(typeof view.world!=='string'||!view.world.startsWith('/')||view.world.startsWith('//')||view.world.includes('\\')||!new URL(view.world,'https://local.invalid').pathname.endsWith('.json'))throw new Error('保存世界の参照が不正です');
  const result={schema:view.schema,terrain:view.terrain,world:view.world};
  for(const[key,[min,max]]of Object.entries(FIELDS))if(view[key]!==undefined){if(typeof view[key]!=='number'||!Number.isFinite(view[key])||view[key]<min||view[key]>max)throw new Error(`保存した配置 ${key} が不正です`);result[key]=view[key];}
  for(const key of ['sfParentWorld','sfOutletIdentity'])if(view[key]!==undefined){if(typeof view[key]!=='string'||view[key].length<1||view[key].length>256)throw new Error(`保存世界・流出口の識別子 ${key} が不正です`);result[key]=view[key];}
  for(const [key,version] of Object.entries(VERSIONS))if(view[key]!==undefined){if(view[key]!==version)throw new Error(`保存した設計バージョン ${key} が現在の実行環境と一致しません`);result[key]=view[key];}
  if(view.terrain==='shape-first'&&['sfLat','sfLon','sfElevation','sfTransition','sfParentWorld','sfChannelVersion','sfRuntimeVersion','sfOutletIdentity'].some(key=>view[key]===undefined))throw new Error('球面配置の記録が未確定です。配置の読込完了後に書き出してください。');
  if(view.sfLevel!==undefined){if(!['auto','0','1','2','3','4'].includes(view.sfLevel))throw new Error('詳細段階が不正です');result.sfLevel=view.sfLevel;}
  if(view.sfView!==undefined){if(view.sfView!=='global')throw new Error('視点の保存値が不正です');result.sfView=view.sfView;}
  if(view.sfSymbols!==undefined){if(!['on','off'].includes(view.sfSymbols))throw new Error('河川記号の保存値が不正です');result.sfSymbols=view.sfSymbols;}
  return result;
}
export function captureShapeFirstView(href) {
  const url=new URL(href),world=new URL(url.searchParams.get('world')??'../../examples/planet/generated/manifest.json',url);
  if(world.origin!==url.origin)throw new Error('外部サイトの世界を含む配置の書出しには対応していません');
  const view={schema:'shape-first-view@1',terrain:url.searchParams.get('terrain')==='shape-first-inspect'?'shape-first-inspect':'shape-first',world:world.pathname+world.search};
  for(const key of Object.keys(FIELDS))if(url.searchParams.has(key))view[key]=Number(url.searchParams.get(key));
  for(const key of STRINGS)if(url.searchParams.has(key))view[key]=url.searchParams.get(key);
  return validateShapeFirstView(view);
}
export function restoreShapeFirstView(href,record) {
  const url=new URL(href),view=validateShapeFirstView(record.view);
  if(!view&&url.searchParams.get('sfSeed')!==record.seed){url.searchParams.delete('sfOutletIdentity');url.searchParams.delete('sfElevation');}
  url.searchParams.set('sfSeed',record.seed);
  if(view){for(const key of ['terrain','world',...Object.keys(FIELDS),...STRINGS]){url.searchParams.delete(key);if(view[key]!==undefined)url.searchParams.set(key,String(view[key]));}}
  return url.href;
}
