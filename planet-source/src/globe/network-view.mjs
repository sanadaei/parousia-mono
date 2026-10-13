import {readPage} from './page-request.mjs';
const $=id=>document.getElementById(id),canvas=$('map'),ctx=canvas.getContext('2d'),params=new URLSearchParams(location.search),world=new URL(params.get('world')??'../../examples/planet/generated/manifest.json',location.href);
let data,manifest;
function draw(){const {columns:w,rows:h}=data.grid,sx=canvas.width/w,sy=canvas.height/h;ctx.clearRect(0,0,canvas.width,canvas.height);for(let i=0;i<data.score.length;i++){const v=data.score[i];ctx.fillStyle=data.wetMask[i]?'#234f70':`rgb(${Math.round(145-v)},${Math.round(55+v*1.5)},65)`;ctx.fillRect(i%w*sx,Math.floor(i/w)*sy,sx+1,sy+1);}
 const xy=p=>[((p.lonDeg%360+360)%360)/360*canvas.width,(90-p.latDeg)/180*canvas.height];
 if($('routes').checked){ctx.strokeStyle='#f2c66b';ctx.lineWidth=1;for(const r of data.routes){ctx.beginPath();r.points.forEach((p,i)=>{const [x,y]=xy(p);if(!i||Math.abs(x-xy(r.points[i-1])[0])>canvas.width/2)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();}}
 if($('sites').checked){ctx.fillStyle='#fff';for(const s of data.sites){const[x,y]=xy(s);ctx.beginPath();ctx.arc(x,y,s.id===$('place').value?5:2.5,0,Math.PI*2);ctx.fill();}}
}
function showCell(i){$('selection').textContent=`セル ${i}\n広域セルの簡易居住適性 ${data.score[i]} / 100\n広域の近隣勾配 ${(data.macroSlope[i]*100).toFixed(2)}%\nモデル上の河川・湖まで ${data.waterDistanceM[i]==null?'不明':(data.waterDistanceM[i]/1000).toFixed(1)+' km'}\n${data.wetMask[i]?'海・湖のため居住候補から除外':'陸地（局所の敷地条件は未調査）'}`;}
$('place').onchange=()=>{const p=data.sites.find(x=>x.id===$('place').value);if(p){showCell(p.cellIndex);$('selection').textContent+=`\n${p.name} / ${p.id}\n${p.buildings==null?'建物未生成・位置候補のみ':`建物生成済み ${p.buildings}棟（広域セル評価は実敷地の評価とは異なる）`}`;const link=new URL('./index.html',location.href);link.searchParams.set('world',world.href);link.searchParams.set('site',p.id);if(params.get('renderer')==='software')link.searchParams.set('renderer','software');$('visit').href=link.href;$('visit').hidden=false;}draw();};
for(const id of ['routes','sites'])$(id).onchange=()=>data&&draw();
canvas.onclick=e=>{if(!data)return;const r=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(data.grid.columns-1,Math.floor((e.clientX-r.left)/r.width*data.grid.columns))),y=Math.max(0,Math.min(data.grid.rows-1,Math.floor((e.clientY-r.top)/r.height*data.grid.rows)));showCell(y*data.grid.columns+x);};
try{if(world.origin!==location.origin)throw new Error('同じサーバーの世界だけを読めます');manifest=JSON.parse(await readPage(fetch,world.href,{kind:'text'}));data=manifest.settlementNetwork;if(!data)throw new Error('この保存世界には居住適性・広域ルートのデータがありません。更新したサーバーからseedを指定して新しい保存版を生成してください。');
 $('status').textContent=`候補 ${data.sites.length} / ルート ${data.routes.length} / 陸路接続不可 ${data.unconnected.length} / 解像度 ${data.grid.columns}×${data.grid.rows}`;
 for(const p of data.sites){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name} · ${p.id} · 適性${p.score}`;$('place').append(option);}
 $('coverage').textContent=(data.populationId?'月別気温・生育期降水・雨頼み穀物生産による人口容量を追加した選定です。人口は地域集計。土壌・収量・耕作率は明示した仮定です。\n':'')+'旧地形評価の基礎:  標高、近隣セル勾配、海・湖、河川・湖への距離\n未評価: 実測土壌、飲用可能性、資源、制度、局所洪水\n元の広域セルで評価。地球サイズ128×64ならセルは数百kmあり、町の敷地を保証しません。\nルートは乾いたセルをつなぐ候補。実際の小河川・崖・峠の測量と橋の設計が必要です。島に勝手な陸路を作りません。\n重み: 勾配45%、標高30%、河川・湖への距離25%。ゲーム上の仮定です。追加候補は緯度±65度以内に限定（実際の気温評価ではない）。';draw();
}catch(e){$('status').textContent=e.message;}
