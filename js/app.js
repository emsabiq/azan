// ====== KONFIG (khusus 2 fokus ini) ======
const VIDEO_BASE = 'videos';
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const TIME_ADJ_KEY  = 'wib_adj_min'; // ?adj=+/-menit di query untuk koreksi jam TV

// ====== DETEKSI MODE TV (opsional untuk styling ringan) ======
const IS_TV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
           || new URLSearchParams(location.search).has('tv');
document.addEventListener('DOMContentLoaded', () => {
  if (IS_TV) document.documentElement.classList.add('tv-mode');
});

// ====== WIB HELPERS (+ offset manual) ======
function pad2(n){ return n<10 ? '0'+n : ''+n }
function getAdjMin(){
  const qp = new URLSearchParams(location.search);
  if (qp.has('adj')){
    const v = parseInt(qp.get('adj'),10) || 0;
    localStorage.setItem(TIME_ADJ_KEY, String(v));
    return v;
  }
  return parseInt(localStorage.getItem(TIME_ADJ_KEY) || '0', 10);
}
function getWIBParts(now = new Date()){
  const localOffsetMin = -now.getTimezoneOffset(); // timur UTC positif
  const deltaMin = 420 - localOffsetMin;           // 420 = UTC+7 (WIB)
  const adj = getAdjMin();
  const t = new Date(now.getTime() + (deltaMin + adj) * 60000);
  const y  = t.getFullYear();
  const m  = pad2(t.getMonth()+1);
  const d  = pad2(t.getDate());
  const hh = pad2(t.getHours());
  const mm = pad2(t.getMinutes());
  const ss = pad2(t.getSeconds());
  return { y,m,d,hh,mm,ss, ymd:`${y}-${m}-${d}`, hhmm:`${hh}:${mm}`, hhmmss:`${hh}:${mm}:${ss}` };
}

// ====== fetch JSON (punya fallback XHR untuk TV lama) ======
async function fetchJSON(url){
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return await r.json();
  } catch {
    // fallback XHR (lebih toleran di beberapa TV)
    return new Promise((res, rej)=>{
      try{
        const x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.responseType = 'text';
        x.onreadystatechange = ()=>{
          if (x.readyState === 4){
            if (x.status >= 200 && x.status < 300) {
              try { res(JSON.parse(x.responseText)); }
              catch(e){ rej(e); }
            } else rej(new Error('HTTP '+x.status));
          }
        };
        x.timeout = 8000;
        x.ontimeout = ()=>rej(new Error('XHR timeout'));
        x.send();
      } catch(e){ rej(e); }
    });
  }
}

// ====== MyQuran v2: ambil ID Medan + jadwal hari ini ======
let jadwalSholat = {};
async function resolveMedanId(){
  const c = localStorage.getItem(KOTA_CACHE_KEY);
  if (c) return c;
  const json = await fetchJSON('https://api.myquran.com/v2/sholat/kota/semua');
  const list = json?.data || [];
  const kota = list.find(k => /^kota\s*medan$/i.test(k.lokasi)) || list.find(k => /^medan$/i.test(k.lokasi));
  if (!kota) throw new Error('Kota Medan tidak ditemukan di MyQuran');
  localStorage.setItem(KOTA_CACHE_KEY, kota.id);
  return kota.id;
}
async function fetchJadwalHariIni(){
  const { y, m, d } = getWIBParts();
  const id = await resolveMedanId();
  const json = await fetchJSON(`https://api.myquran.com/v2/sholat/jadwal/${id}/${y}/${+m}/${+d}`);
  const j = json?.data?.jadwal;
  if (!j) throw new Error('Respon MyQuran tidak berisi jadwal');

  // normalize "HH:MM"
  const norm = s => (s||'').slice(0,5);
  jadwalSholat = {
    subuh:   norm(j.subuh),
    dzuhur:  norm(j.dzuhur),
    ashar:   norm(j.ashar),
    maghrib: norm(j.maghrib),
    isya:    norm(j.isya)
  };

  // render ke UI (pastikan ID ada di HTML)
  [['subuh','subuh'],['dzuhur','dzuhur'],['ashar','ashar'],['maghrib','maghrib'],['isya','isya']]
    .forEach(([k,id]) => { const el = document.getElementById(id); if (el) el.textContent = jadwalSholat[k]; });
}

// ====== CLOCK ringan (untuk tampilan jam) ======
let elClock = null, lastClockText = '';
function tickClock(){
  const { hhmmss } = getWIBParts();
  if (!elClock) elClock = document.getElementById('current-time');
  if (elClock && hhmmss !== lastClockText){
    elClock.textContent = hhmmss;
    lastClockText = hhmmss;
  }
}
(function loopClock(){
  const ms = 1000 - (Date.now() % 1000) + 5;
  setTimeout(()=>{ try{ tickClock(); } finally{ loopClock(); } }, ms);
})();

// ====== VIDEO LOOPING (TV-safe) ======
async function loadLoopVideo(){
  const el = document.getElementById('bg-video');
  if (!el) return;

  // Set proper flags agar autoplay di TV lebih “patuh”
  try {
    el.disablePictureInPicture = true;
    el.setAttribute('disablepictureinpicture','');
    el.disableRemotePlayback = true;
    el.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');
    el.autoplay = true; el.muted = true; el.loop = true; el.preload = 'auto';
    el.playsInline = true; el.setAttribute('playsinline','');
  } catch {}

  const { ymd } = getWIBParts();
  const candidates = [
    `${VIDEO_BASE}/${ymd}.mp4`,   // video harian
    `${VIDEO_BASE}/latest.mp4`,   // terbaru
    `${VIDEO_BASE}/default.mp4`   // fallback
  ];

  for (const src of candidates){
    const ok = await tryAttachVideo(el, src);
    if (ok) return; // selesai bila ada yang berhasil
  }
  // Fallback terakhir: kosongkan sumber (biar halaman tetap jalan)
  el.removeAttribute('src'); try{ el.load?.(); }catch{}
}
function tryAttachVideo(el, src){
  return new Promise((resolve)=>{
    let done = false;
    const cleanup = ()=>{
      el.removeEventListener('loadedmetadata', onLoaded, true);
      el.removeEventListener('error', onError, true);
      clearTimeout(timer);
    };
    const onLoaded = ()=>{
      if (done) return; done = true; cleanup();
      // beberapa TV butuh .play() setelah metadata siap
      el.play().catch(()=>{});
      resolve(true);
    };
    const onError = ()=>{
      if (done) return; done = true; cleanup();
      resolve(false);
    };
    const timer = setTimeout(()=>{
      if (!done){ done = true; cleanup(); resolve(false); }
    }, 6000);

    // paksa cache-bust agar TV tidak ngelock ke versi lama
    el.src = `${src}?v=${Date.now()}`;
    el.addEventListener('loadedmetadata', onLoaded, { once:true, capture:true });
    el.addEventListener('error', onError, { once:true, capture:true });
  });
}

// ====== REFRESH JADWAL saat ganti hari (WIB) ======
let lastYMD = '';
async function boot(){
  // 1) Muat video looping
  await loadLoopVideo();

  // 2) Ambil jadwal adzan hari ini (Medan)
  await fetchJadwalHariIni();
  lastYMD = getWIBParts().ymd;

  // 3) Cek pergantian hari tiap 30 detik → refresh jadwal + video
  setInterval(async ()=>{
    const { ymd, hhmm } = getWIBParts();
    if (ymd !== lastYMD && hhmm >= '00:05'){ // buffer 5 menit
      lastYMD = ymd;
      await fetchJadwalHariIni().catch(()=>{});
      await loadLoopVideo().catch(()=>{});
    }
  }, 30000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
