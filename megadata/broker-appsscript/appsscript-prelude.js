/* Apps Script synchronous-Promise prelude — MUST be the FIRST part of the
   pasted file. Google's runtime only runs promise callbacks after the whole
   request finishes, so a "wait for the promise" loop inside doPost waits
   forever (the live symptom: {"error":"internal timeout"}). Every await-able
   thing the broker does is actually synchronous under Apps Script (the
   digest uses Utilities.computeDigest), so this shadows `Promise` with a
   drop-in whose callbacks run IMMEDIATELY on settle. Outside Apps Script
   (no `Utilities`) it leaves the native Promise untouched. */
var Promise = (typeof Utilities !== 'undefined' && Utilities.computeDigest ? (function () {
  'use strict';
  function SyncPromise(executor) {
    var self = this;
    this._s = 0; this._v = undefined; this._cbs = [];
    function settle(s, v) {
      if (self._s) return;
      if (s === 1 && v && typeof v.then === 'function') {
        v.then(function (x) { settle(1, x); }, function (e) { settle(2, e); });
        return;
      }
      self._s = s; self._v = v;
      var cbs = self._cbs; self._cbs = [];
      for (var i = 0; i < cbs.length; i++) cbs[i]();
    }
    try { executor(function (v) { settle(1, v); }, function (e) { settle(2, e); }); }
    catch (e) { settle(2, e); }
  }
  SyncPromise.prototype.then = function (onF, onR) {
    var self = this;
    return new SyncPromise(function (res, rej) {
      function run() {
        try {
          if (self._s === 1) { res(typeof onF === 'function' ? onF(self._v) : self._v); }
          else if (typeof onR === 'function') { res(onR(self._v)); }
          else { rej(self._v); }
        } catch (e) { rej(e); }
      }
      if (self._s) run(); else self._cbs.push(run);
    });
  };
  SyncPromise.prototype.catch = function (onR) { return this.then(null, onR); };
  SyncPromise.prototype.finally = function (f) {
    return this.then(function (v) { f(); return v; }, function (e) { f(); throw e; });
  };
  SyncPromise.resolve = function (v) { return new SyncPromise(function (res) { res(v); }); };
  SyncPromise.reject = function (e) { return new SyncPromise(function (_res, rej) { rej(e); }); };
  SyncPromise.all = function (arr) {
    return new SyncPromise(function (res, rej) {
      var out = [], left = arr.length;
      if (!left) return res(out);
      arr.forEach(function (p, i) {
        SyncPromise.resolve(p).then(function (v) { out[i] = v; if (!--left) res(out); }, rej);
      });
    });
  };
  return SyncPromise;
})() : globalThis.Promise);
