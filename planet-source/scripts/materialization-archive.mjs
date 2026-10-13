import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateMaterializationRecord as validate,encodeMaterializationArchive,decodeMaterializationArchive,MATERIALIZATION_ARCHIVE_LIMIT as MAX_TOTAL,MATERIALIZATION_ARCHIVE_COUNT as MAX_COUNT} from '../src/core/materialization-archive.mjs';
const MAX_RECORD=16*1024*1024;
const filename=key=>createHash('sha256').update(key).digest('hex')+'.json';
/** Portable immutable result records, not the base planet files or browser data.
 * Export only while the source writer is stopped: an archive is a directory
 * snapshot, not a transaction across concurrent generators. */
export function exportMaterializations(directory,archiveFile){
 const names=fs.readdirSync(directory).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).sort();
 if(names.length>MAX_COUNT)throw new RangeError('Too many records for this archive');
 const entries=[];let bytes=0;
 for(const name of names){const p=path.join(directory,name),st=fs.lstatSync(p);if(!st.isFile()||st.size>MAX_RECORD)throw new Error('Invalid archive source record');bytes+=st.size;if(bytes>MAX_TOTAL)throw new RangeError('Archive exceeds bounded transfer size');const record=JSON.parse(fs.readFileSync(p,'utf8'));validate(record);if(filename(record.key)!==name)throw new Error('Record filename does not match identity');entries.push(record);}
 const text=encodeMaterializationArchive(entries);
 if(Buffer.byteLength(text)>MAX_TOTAL)throw new RangeError('Archive exceeds bounded transfer size');
 fs.writeFileSync(archiveFile,text,{flag:'wx',mode:0o600});return{records:entries.length,bytes:Buffer.byteLength(text),worldIds:[...new Set(entries.map(r=>r.worldId))]};
}
/** Restores only into a new directory. No merge/overwrite of existing choices.
 * Complete validation precedes writing. Restore while all readers/writers are
 * stopped; the target becomes usable only after this function succeeds. A
 * process crash may leave a partial directory; restore again to a new path. */
export function importMaterializations(archiveFile,directory){
 const st=fs.lstatSync(archiveFile);if(!st.isFile()||st.size>MAX_TOTAL)throw new RangeError('Invalid archive size');
 const records=decodeMaterializationArchive(fs.readFileSync(archiveFile,'utf8'));
 if(fs.existsSync(directory))throw new Error('Restore destination must be new; existing choices are never overwritten');
 const keys=new Set(),texts=records.map(r=>{const text=validate(r);if(keys.has(r.key))throw new Error('Duplicate materialization identity');keys.add(r.key);return[filename(r.key),text];});
 const parent=path.dirname(path.resolve(directory));fs.mkdirSync(parent,{recursive:true});const staging=path.join(parent,`.planet-restore-${randomUUID()}`);fs.mkdirSync(staging,{mode:0o700});
 try{for(const [name,text] of texts)fs.writeFileSync(path.join(staging,name),text,{flag:'wx',mode:0o600});
 // Create destination exclusively. On failure only this operation's files are
 // removed; an existing destination is never touched. Use an empty destination
 // plus exclusive file links, then remove it if any link fails.
 fs.mkdirSync(directory,{mode:0o700});try{for(const [name] of texts)fs.linkSync(path.join(staging,name),path.join(directory,name));}catch(e){for(const [name] of texts){const p=path.join(directory,name);if(fs.existsSync(p)&&fs.statSync(p).ino===fs.statSync(path.join(staging,name)).ino)fs.unlinkSync(p);}try{fs.rmdirSync(directory);}catch{}throw e;}
 }finally{fs.rmSync(staging,{recursive:true,force:true});}
 return{records:texts.length,worldIds:[...new Set(records.map(r=>r.worldId))],requiresOriginalPlanet:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const[mode,source,target]=process.argv.slice(2);if(!['export','import'].includes(mode)||!source||!target)throw new Error('Usage: node scripts/materialization-archive.mjs export SAVE_DIR NEW_ARCHIVE.json | import ARCHIVE.json NEW_SAVE_DIR');console.log(JSON.stringify(mode==='export'?exportMaterializations(source,target):importMaterializations(source,target),null,2));}
