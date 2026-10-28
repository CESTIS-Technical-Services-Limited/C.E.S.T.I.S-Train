/* index.html (inline copy) — the device store EXACTLY as it was before the trainee gate
   added its namespace switch (integration branch at 2001866). Frozen on
   purpose: tests/store-namespace.test.js runs it beside the current store
   and requires the same behaviour, write for write, while the switch is
   off. Never edit it to make that test pass. If the store itself is
   deliberately changed later, refreeze it from the commit before that
   change and say so in that commit. */
(function(){
  if (window.CESTISStore) return;
  var DB_NAME='CESTIS_KV', STORE='kv', LS=null;
  try { LS = window.localStorage; } catch(e) { LS = null; }
  var cache = {};
  // Seed synchronously from localStorage so data is available immediately.
  try { if(LS){ for(var i=0;i<LS.length;i++){ var k=LS.key(i); cache[k]=LS.getItem(k); } } } catch(e){}

  var db=null, ready=false, wq=[];
  // Durable-write failure tracking: quota errors on the IndexedDB transaction
  // fire asynchronously (transaction onerror/onabort), so a plain try/catch
  // never sees them. Record the failure and notify the app so it can warn the
  // user instead of silently losing every write from that point on.
  var writeFailCount = 0;
  function reportWriteFailure(k, err){
    writeFailCount++;
    try { window._cestisStoreWriteFailures = writeFailCount; } catch(_){}
    try { console.error('[CESTISStore] Durable write FAILED for key "' + k + '":', err); } catch(_){}
    try { window.dispatchEvent(new CustomEvent('cestis-store-write-error', { detail: { key: k, count: writeFailCount } })); } catch(_){}
  }
  function drainQueue(){ var q=wq; wq=[]; for(var i=0;i<q.length;i++){ writeIDB(q[i].k,q[i].v,q[i].del); } }
  function writeIDB(k,v,del){
    if(!db){ if(!ready){ wq.push({k:k,v:v,del:del}); } return; }
    try {
      var tx=db.transaction(STORE,'readwrite');
      tx.onerror = function(e){ reportWriteFailure(k, e && e.target && e.target.error); };
      tx.onabort = function(e){ reportWriteFailure(k, (e && e.target && e.target.error) || 'transaction aborted'); };
      var os=tx.objectStore(STORE); if(del){ os.delete(k); } else { os.put(v,k); }
    } catch(e){ reportWriteFailure(k, e); }
  }
  // Ask the browser to protect this origin's storage from automatic eviction —
  // essential for a system whose primary datastore is IndexedDB for years.
  try { if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
  try {
    var req = indexedDB.open(DB_NAME,1);
    req.onupgradeneeded = function(e){ var d=e.target.result; if(!d.objectStoreNames.contains(STORE)){ d.createObjectStore(STORE); } };
    req.onsuccess = function(e){
      db = e.target.result;
      try {
        var idbKeys = {};
        var cur = db.transaction(STORE,'readonly').objectStore(STORE).openCursor();
        cur.onsuccess = function(ev){ var c=ev.target.result;
          if(c){ idbKeys[c.key]=1; if(!(c.key in cache)){ cache[c.key]=c.value; } c.continue(); }
          else {
            // One-time migration: copy any localStorage-seeded keys into IndexedDB.
            try { var ws=db.transaction(STORE,'readwrite').objectStore(STORE);
                  for(var kk in cache){ if(Object.prototype.hasOwnProperty.call(cache,kk) && !idbKeys[kk]){ ws.put(cache[kk], kk); } } } catch(_){}
            ready=true; drainQueue(); try{ window.dispatchEvent(new Event('cestis-store-ready')); }catch(_){}
          }
        };
        cur.onerror = function(){ ready=true; drainQueue(); };
      } catch(e){ ready=true; drainQueue(); }
    };
    req.onerror = function(){ db=null; ready=true; };
  } catch(e){ db=null; ready=true; }

  var Store = {
    _cache: cache,
    // Read through to localStorage before trusting the cache. Every document
    // (this page, its iframes, other tabs) runs its OWN copy of this store, so a
    // key written elsewhere would otherwise still read as our stale copy — and
    // saving that copy back silently reverts the other document's write. The
    // 'storage' event below is not enough on its own: it arrives asynchronously,
    // while a re-read immediately after an iframe reports a change is synchronous.
    getItem: function(k){
      k=String(k);
      // When localStorage is full its write throws and the PREVIOUS value is
      // left sitting there untouched. This read trusts any non-null answer
      // from localStorage, so from that moment on every read returned the
      // STALE copy while the data the user had just entered sat unreachable
      // in IndexedDB — and the next save wrote the stale copy back over the
      // good one and uploaded it. Dropping the stale entry on a failed write
      // (see setItem below) is what makes this read safe.
      if(LS){ try { var lv = LS.getItem(k); if(lv !== null){ cache[k] = lv; return lv; } } catch(e){} }
      return (k in cache) ? cache[k] : null;
    },
    setItem: function(k,v){
      k=String(k); v=String(v); cache[k]=v;
      // A failed localStorage write leaves the OLD value in place. Left there,
      // it out-votes the truth on every later read (see getItem above), so the
      // stale entry is removed and the read falls through to the cache and
      // IndexedDB, which both hold what was actually written.
      try{ if(LS) LS.setItem(k,v); }
      catch(e){
        try{ if(LS) LS.removeItem(k); }catch(e2){}
        if (typeof reportWriteFailure === 'function') reportWriteFailure(k, e);
      }
      writeIDB(k,v,false);
    },
    removeItem: function(k){ k=String(k); delete cache[k]; try{ if(LS) LS.removeItem(k); }catch(e){} writeIDB(k,null,true); },
    clear: function(){ for(var k in cache){ if(Object.prototype.hasOwnProperty.call(cache,k)) delete cache[k]; }
                       try{ if(LS) LS.clear(); }catch(e){}
                       if(db){ try{ db.transaction(STORE,'readwrite').objectStore(STORE).clear(); }catch(e){} } },
    key: function(i){ return Object.keys(cache)[i]; },
    keys: function(){ return Object.keys(cache); },
    hasOwnProperty: function(k){ return Object.prototype.hasOwnProperty.call(cache, String(k)); },
    whenReady: function(cb){ if(ready){ cb(); } else { window.addEventListener('cestis-store-ready', cb, {once:true}); } },
    get length(){ return Object.keys(cache).length; }
  };
  // Deletions and clears cannot be seen by the read-through above (a removed key
  // and a key too large for localStorage both read as null), so mirror them from
  // the storage event, which fires in every OTHER document of this origin.
  try {
    window.addEventListener('storage', function(ev){
      if(!ev) return;
      if(ev.key === null){ for(var ck in cache){ if(Object.prototype.hasOwnProperty.call(cache,ck)) delete cache[ck]; } return; }
      var sk = String(ev.key);
      if(ev.newValue === null){ delete cache[sk]; } else { cache[sk] = ev.newValue; }
    });
  } catch(e){}
  window.CESTISStore = Store;
})();
