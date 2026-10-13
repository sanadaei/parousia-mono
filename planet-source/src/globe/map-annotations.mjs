import {sphereBasis,offsetGeographic} from '../core/spherical.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
// Grab-the-ground navigation: move the camera opposite to screen-right/up.
// Heading follows camera(): screen-right = east*cos(heading)-north*sin(heading).
export function dragPoint(point,dx,dy,altitude,height,heading,radius){
 const scale=altitude/Math.max(1,height),east=(-dx*Math.cos(heading)+dy*Math.sin(heading))*scale,north=(dx*Math.sin(heading)+dy*Math.cos(heading))*scale;
 return offsetGeographic(point,east,north,radius);
}
export function projectSettlement(place,camera,radius,width,height){
 const up=sphereBasis(place).up,p=up.map(v=>v*(radius+(place.elevationM??0)*(camera.heightScale??1))),v=p.map((x,i)=>x-camera.eye[i]);
 // Sphere occlusion: do not label settlements on the far hemisphere.
 if(dot(up,camera.eye)<radius)return null;
 const z=dot(v,camera.forward);if(z<=camera.near)return null;
 const x=(1+dot(v,camera.right)*camera.focal/camera.aspect/z)*width/2,y=(1-dot(v,camera.up)*camera.focal/z)*height/2;
 if(x<0||y<0||x>width||y>height)return null;
 return{x,y,id:place.id,text:`${place.name} · ${place.id}`};
}
export function dataAvailability(manifest){return[
 {name:'標高',status:'データ・3D表示あり',detail:`高さの強調倍率を選択可能。中心点の地盤高は元の標高を表示。基準: ${manifest.base.frame.verticalDatum??'世界の標高基準'}。`},
 {name:'等高線',status:'全球画面で切替可',detail:'10・20・50・100・500・1000m間隔。表示地形のLOD精度に依存します。'},
 {name:'気温・バイオーム',status:manifest.climate?'モデルデータあり':'この保存世界にはデータなし',detail:'新規生成世界は全球3Dの地図レイヤーと比較画面で確認できます。近似モデルで、天気予報や実際の植生調査ではありません。'},
 {name:'居住適性',status:manifest.population?'気候・農業・人口接続あり':manifest.settlementNetwork?'簡易地形・水域評価あり（気候等は未評価）':'この保存世界には適性データなし',detail:manifest.population?'月別気候→雨頼み農業→地域人口→集落選定。土壌・収量は仮定。局所の敷地条件・交易は未評価。':'旧保存世界には気候・食料の接続がありません。新しいseed生成版で確認できます。'},
 {name:'領有',status:manifest.territories?'固定ID・広域の仮領域を保存済み':manifest.climate&&manifest.population?'広域の仮領域を表示時に作成可能':'必要な気候・人口データなし',detail:'地図レイヤー「領有」で確認。歴史・個人の土地所有・争われている領域は未実装。境界は広域セル単位です。'}
];}
