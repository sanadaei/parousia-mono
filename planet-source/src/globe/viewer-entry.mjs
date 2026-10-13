import {ordinaryGlobeURL} from './world-link.mjs';
import {installShapeFirstSourceControls} from './shape-first-controls.mjs';
// The experiment is a selectable runtime view, isolated from saved planet data.
const mode = new URL(location.href).searchParams.get('terrain');
if (mode === 'shape-first-inspect') {
  import('./shape-first-view.mjs').then(m => m.mountShapeFirstView()).catch(error => {
    document.body.replaceChildren(); const message=document.createElement('p');
    message.setAttribute('role','alert');message.textContent=`形を先に作る地域ビューを開けません: ${error.message}`;
    const back=document.createElement('a');back.href='./index.html';back.textContent='惑星ビューへ戻る';document.body.append(message,back);
  });
} else {
  const label=document.createElement('label');label.textContent='地形ビュー ';
  const select=document.createElement('select');select.id='terrain-view';select.setAttribute('aria-label','地形ビュー');
  for(const[value,text]of[['globe','保存した惑星'],['shape-first','形を先に作る惑星地形（試作）'],['shape-first-inspect','形状・水の地域検査（試作）']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=mode==='shape-first'?'shape-first':'globe';
  select.addEventListener('change',()=>{if(select.value==='globe'){location.href=ordinaryGlobeURL(location.href);return;}const url=new URL(location.href);url.searchParams.set('terrain',select.value);location.href=url.href;});
  label.append(select);document.querySelector('.controls').prepend(label);
  if(mode==='shape-first'){const sources=document.createElement('div');sources.id='shape-first-source-controls';label.after(sources);installShapeFirstSourceControls(sources);}
  import('./app.mjs?revision=planet-world-6').catch(error=>{const panel=document.getElementById('error');panel.hidden=false;panel.textContent=error.message;});
}
