import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shapeFirstPanelSummary,installShapeFirstPanel} from '../src/globe/shape-first-panel.mjs';

test('compact summary retains storage and outlet caveats without technical dump',()=>{
 const model={rivers:Array(40),storageStatus:'saved'};
 assert.equal(shapeFirstPanelSummary(model,{outletConnection:{}}),'40本の川と谷 · 流出口を保存河川へ接続\n初回の形状を保存済み');
 const temporary=shapeFirstPanelSummary({...model,storageStatus:'memory-only'},{});assert.match(temporary,/未接続/);assert.match(temporary,/未保存/);assert(temporary.length<80);
});

class Element {
 constructor(tag){this.tagName=tag;this.childNodes=[];this.parentNode=null;this.dataset={};this.attributes={};this.hidden=false;this.textContent='';this.classList={add:(...values)=>{this.className=[this.className??'',...values].join(' ');}};}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.childNodes.push(node);}}
 prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentNode=this;this.childNodes.unshift(node);}}
 remove(){if(this.parentNode){this.parentNode.childNodes=this.parentNode.childNodes.filter(n=>n!==this);this.parentNode=null;}}
 replaceChildren(...nodes){for(const child of [...this.childNodes])child.remove();this.append(...nodes);}
 after(node){node.remove();const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this)+1,0,node);node.parentNode=p;}
 closest(tag){let n=this;while(n&&n.tagName!==tag)n=n.parentNode;return n;}
 querySelector(tag){return this.childNodes.flatMap(n=>[n,n.querySelector(tag)]).find(n=>n?.tagName===tag)??null;}
 setAttribute(key,value){this.attributes[key]=value;}
}
function walk(node){return [node,...node.childNodes.flatMap(walk)];}
test('panel polish preserves live controls, collapses diagnostics and supports hide/reopen',()=>{
 const globals={document:globalThis.document,location:globalThis.location},body=new Element('body'),head=new Element('head'),panel=new Element('aside');body.append(panel);
 const make=(tag,id,parent=panel)=>{const e=new Element(tag);e.id=id;parent.append(e);return e;};
 make('h1','legacy-heading');const modeLabel=make('label','mode-label');make('select','terrain-view',modeLabel);const source=make('div','shape-first-source-controls');make('button','sf-export',source);const legacy=make('button','legacy-diagnostic');
 for(const id of ['river','height','tilt','height-scale'])make('input',id,make('label',`${id}-label`));
 const status=make('p','shape-first-planet-status');status.textContent='Technical original information';const regionButton=make('button','shape-first-region');let invoked=0;regionButton.onclick=()=>invoked++;const symbolLabel=make('label','symbol-label');make('input','shape-first-symbols',symbolLabel);
 globalThis.document={body,head,createElement:tag=>new Element(tag),querySelector:query=>query==='.controls'?panel:null,getElementById:id=>walk(body).find(n=>n.id===id)};
 globalThis.location={href:'https://planet.test/src/globe/index.html?terrain=shape-first&sfSeed=chosen&sfOutletIdentity=route'};
 try{
 installShapeFirstPanel({model:{rivers:Array(40),sourceLabel:'保存した形状 A',storageStatus:'saved'},manifest:{shapeFirstRegion:{outletConnection:{}}},status,regionButton,symbolLabel});
 assert.equal(walk(body).filter(n=>n.id==='shape-first-region').length,1);regionButton.onclick();assert.equal(invoked,1);
 assert.equal(legacy.parentNode.id,'shape-first-advanced');assert.equal(legacy.parentNode.open,undefined);assert.equal(symbolLabel.parentNode.id,'shape-first-view-options');
 assert(walk(body).some(n=>n.textContent==='Technical original information'));assert(status.textContent.length<80);
 const link=globalThis.document.getElementById('shape-first-inspect-link'),url=new URL(link.href);assert.equal(url.searchParams.get('terrain'),'shape-first-inspect');assert.equal(url.searchParams.get('sfSeed'),'chosen');assert.equal(url.searchParams.get('sfOutletIdentity'),'route');
 const toggle=globalThis.document.getElementById('shape-first-panel-toggle');toggle.onclick();assert.equal(panel.hidden,true);assert.equal(toggle.attributes['aria-expanded'],'false');toggle.onclick();assert.equal(panel.hidden,false);
 installShapeFirstPanel({model:{},manifest:{},status,regionButton,symbolLabel});assert.equal(walk(body).filter(n=>n.id==='shape-first-panel-toggle').length,1);
 }finally{for(const[key,value]of Object.entries(globals))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
test('panel width and long content handling are scoped to the draft view',()=>{
 const css=readFileSync(new URL('../src/globe/shape-first-panel.css',import.meta.url),'utf8');assert.match(css,/overflow-x:hidden/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/max-width:calc\(100vw/);assert.match(css,/\.shape-first-mode \.controls select/);assert.match(css,/\.controls\[hidden\]/);
});
