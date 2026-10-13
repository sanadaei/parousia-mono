/** Presentation only: existing controls and their listeners are moved, not replaced. */
export function shapeFirstPanelSummary(model,region) {
  const storage=model.storageStatus==='saved'?'初回の形状を保存済み':model.storageStatus==='memory-only'?'一時表示・未保存':'同梱の形状を使用';
  const outlet=region.outletConnection?'流出口を保存河川へ接続':'流出口は未接続';
  return `${model.rivers.length}本の川と谷 · ${outlet}\n${storage}`;
}
export function installShapeFirstPanel({model,manifest,status,regionButton,symbolLabel}) {
  const panel=document.querySelector('.controls');if(!panel||panel.dataset.shapeFirstPolished)return;
  panel.dataset.shapeFirstPolished='true';panel.id='shape-first-panel';document.body.classList.add('shape-first-mode');
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./shape-first-panel.css',import.meta.url).href;document.head.append(css);
  const mode=document.getElementById('terrain-view').closest('label'),sources=document.getElementById('shape-first-source-controls');
  const technicalText=status.textContent;status.textContent=shapeFirstPanelSummary(model,manifest.shapeFirstRegion);status.setAttribute('role','status');
  if(model.storageStatus==='memory-only')status.classList.add('shape-first-unsaved');
  const title=document.createElement('h1');title.textContent='川と谷の地域';
  const source=document.createElement('p');source.className='shape-first-source-name';source.textContent=model.sourceLabel;
  const actions=document.createElement('div');actions.className='row shape-first-actions';regionButton.textContent='地域全体へ';
  const inspect=document.createElement('a'),url=new URL(location.href);url.searchParams.set('terrain','shape-first-inspect');inspect.id='shape-first-inspect-link';inspect.href=url.href;inspect.textContent='平面で検査';inspect.className='shape-first-action';actions.append(regionButton,inspect);
  const views=document.createElement('details');views.id='shape-first-view-options';const viewSummary=document.createElement('summary');viewSummary.textContent='視点・川の表示';views.append(viewSummary);
  for(const id of ['river','height','tilt','height-scale']){const element=document.getElementById(id);if(element)views.append(element.closest('label'));}views.append(symbolLabel);
  const explanation=document.createElement('details');explanation.id='shape-first-explanation';const explanationSummary=document.createElement('summary');explanationSummary.textContent='この試作について';const explanationText=document.createElement('p');explanationText.textContent=technicalText;explanation.append(explanationSummary,explanationText);
  const advanced=document.createElement('details');advanced.id='shape-first-advanced';const advancedSummary=document.createElement('summary');advancedSummary.textContent='その他の設定・診断';advanced.append(advancedSummary);
  // Remove only the duplicate static heading. Preserve every existing operational
  // control (including hidden ones) so later initialization can still find its ID.
  panel.querySelector('h1')?.remove();mode.remove();sources?.remove();status.remove();
  for(const child of [...panel.childNodes])advanced.append(child);
  panel.replaceChildren(title,source,status,actions,mode,...(sources?[sources]:[]),views,explanation,advanced);
  const hint=document.createElement('small');hint.className='shape-first-limit';hint.textContent='形状優先の試作。水理検証済みではありません。';status.after(hint);
  const toggle=document.createElement('button');toggle.id='shape-first-panel-toggle';toggle.type='button';toggle.textContent='設定を隠す';toggle.setAttribute('aria-controls',panel.id);toggle.setAttribute('aria-expanded','true');
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.textContent=panel.hidden?'設定を開く':'設定を隠す';toggle.setAttribute('aria-expanded',String(!panel.hidden));};document.body.append(toggle);
}
