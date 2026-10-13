export class ByteLRU {
  constructor(maxBytes, dispose = () => {}) { this.maxBytes = maxBytes; this.dispose = dispose; this.entries = new Map(); this.bytes = 0; this.evictions = 0; this.revision = 0; this.newestKey = undefined; }
  get(key) { const e = this.entries.get(key); if (!e) return null;
    // Interpolation reads many values from the same page consecutively. A
    // repeated hit on the newest entry cannot change LRU order; avoid churning
    // Map tombstones and triggering collection on every scalar sample.
    if(this.newestKey!==key){this.entries.delete(key);this.entries.set(key,e);this.newestKey=key;}
    return e.value;
  }
  put(key, value, bytes, pinned = new Set()) {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes) throw new RangeError('Cache item exceeds byte budget');
    const oldBytes=this.entries.get(key)?.bytes??0;
    this.reserve(Math.max(0,bytes-oldBytes),new Set([...pinned,key]));
    this.delete(key); this.entries.set(key, { value, bytes }); this.newestKey=key; this.bytes += bytes; this.revision++;
  }
  trim(pinned = new Set()) {
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      if (!pinned.has(key)) this.delete(key, true);
    }
    // Pin sets must fit the budget; callers degrade LOD rather than overcommit.
    if (this.bytes > this.maxBytes) throw new RangeError('Pinned cache exceeds byte budget');
  }
  reserve(bytes, pinned = new Set()) {
    if (!Number.isFinite(bytes)||bytes<0||bytes > this.maxBytes) throw new RangeError('Cache item exceeds byte budget');
    if(this.bytes+bytes<=this.maxBytes)return;
    const reclaimable=[...this.entries].reduce((sum,[key,e])=>sum+(pinned.has(key)?0:e.bytes),0);
    if(this.bytes+bytes-reclaimable>this.maxBytes)throw new RangeError('Pinned cache exceeds byte budget');
    for (const key of this.entries.keys()) {
      if (this.bytes + bytes <= this.maxBytes) break;
      if (!pinned.has(key)) this.delete(key, true);
    }
    if (this.bytes + bytes > this.maxBytes) throw new RangeError('Pinned cache exceeds byte budget');
  }
  delete(key, evicted = false) { const e = this.entries.get(key); if (!e) return; this.entries.delete(key); if(this.newestKey===key)this.newestKey=undefined; this.revision++; this.bytes -= e.bytes; this.dispose(e.value); if (evicted) this.evictions++; }
  clear() { for (const key of [...this.entries.keys()]) this.delete(key); }
}
