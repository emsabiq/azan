// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos';
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';
const TIME_ADJ_KEY = 'wib_adj_min'; // offset menit manual (untuk koreksi jam TV)

// Audio candidates (antisipasi kompatibilitas TV / MIME)
const ADZAN_CANDIDATES = [
  'assets/adzan.mp3',
  'assets/adzan_cbr.mp3',
  'assets/adzan-128k.mp3'
];
const INDO_CANDIDATES = [
  'assets/indonesia-raya.mp3',
  'assets/indonesia-raya_cbr.mp3'
];

// ====== DETEKSI TV / FALLBACK CSS ======
const IS_TV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
           || new URLSearchParams(location.search).has('tv');

document.addEventListener('DOMContentLoaded', () => {
  const lackBackdrop = !(window.CSS && CSS.supports &&
    (CSS.supports('backdrop-filter','blur(4px)') || CSS.supports('-webkit-backdrop-filter','blur(4px)')));
  if (lackBackdrop) document.documentElement.classList.add('no-bdf');
  if (IS_TV) document.documentElement.classList.add('tv-mode');
  // Pastikan body bisa menerima fokus (untuk remote)
  try { document.body.tabIndex = 0; document.body.focus({ preventScroll:true }); } catch {}
});

// ===== WIB HELPERS (dengan dukungan offset manual 'adj' menit) =====
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function getAdjMin(){
  const qp = new URLSearchParams(location.search);
  if (qp.has('adj')) {
    const v = parseInt(qp.get('adj'),10) || 0;
    localStorage.setItem(TIME_ADJ_KEY, String(v));
    return v;
  }
  return parseInt(localStorage.getItem(TIME_ADJ_KEY) || '0', 10);
}
function getWIBParts(now = new Date()){
  const localOffsetMin = -now.getTimezoneOffset(); // timur UTC positif
  const deltaMin = 420 - localOffsetMin;           // 420 = +7 jam (WIB)
  const adj = getAdjMin();                         // koreksi manual menit
  const t = new Date(now.getTime() + (deltaMin + adj) * 60000);
  const y  = t.getFullYear();
  const m  = pad2(t.getMonth()+1);
  const d  = pad2(t.getDate());
  const hh = pad2(t.getHours());
  const mm = pad2(t.getMinutes());
  const ss = pad2(t.getSeconds());
  return { y,m,d,hh,mm,ss, hhmm:`${hh}:${mm}`, hhmmss:`${hh}:${mm}:${ss}`, ymd:`${y}-${m}-${d}` };
}

// ====== STATUS ======
let elStatus = null;
function setStatus(text){
  if (!elStatus) elStatus = document.getElementById('status-pill');
  if (elStatus) elStatus.textContent = text;
  console.log('[STATUS]', text);
}

// ====== fetch JSON dgn fallback XHR (antisipasi CORS/TV lama) ======
async function fetchJSON(url){
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return await r.json();
  } catch (e) {
    // fallback XHR
    setStatus('Fetch fallback (XHR)…');
    return new Promise((res, rej) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.responseType = 'text';
        x.onreadystatechange = () => {
          if (x.readyState === 4) {
            if (x.status >= 200 && x.status < 300) {
              try { res(JSON.parse(x.responseText)); }
              catch (err) { rej(err); }
            } else rej(new Error('HTTP '+x.status));
          }
        };
        x.timeout = 8000;
        x.ontimeout = () => rej(new Error('XHR timeout'));
        x.send();
      } catch (err) { rej(err); }
    });
  }
}

// ====== VIDEO (aman untuk TV) ======
async function loadVideo() {
  const el = document.getElementById('bg-video');
  if (!el) return;

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
    `${VIDEO_BASE}/${ymd}.mp4`,
    `${VIDEO_BASE}/latest.mp4`,
    `${VIDEO_BASE}/default.mp4`
  ];

  for (const src of candidates) {
    const ok = await tryAttachVideo(el, src);
    if (ok) { setStatus('Video siap'); return; }
  }
  el.removeAttribute('src'); try { el.load?.(); } catch {}
  setStatus('Video gagal — hanya widget');
}

function tryAttachVideo(el, src) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded, true);
      el.removeEventListener('error', onError, true);
      clearTimeout(timer);
    };
    const onLoaded = () => { if (done) return; done = true; cleanup(); el.play().catch(()=>{}); resolve(true); };
    const onError  = () => { if (done) return; done = true; cleanup(); resolve(false); };
    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, 6000);

    el.src = `${src}?v=${Date.now()}`;
    el.addEventListener('loadedmetadata', onLoaded, { once:true, capture:true });
    el.addEventListener('error', onError, { once:true, capture:true });
  });
}

// ====== AUDIO COMPAT (multi-candidate + test load) ======
async function ensureAudioCompat(audioEl, candidates){
  for (const src of candidates) {
    const ok = await tryAttachAudio(audioEl, src);
    if (ok) { return true; }
  }
  return false;
}
function tryAttachAudio(el, src){
  return new Promise((resolve)=>{
    let done = false;
    const cleanup = ()=>{
      el.removeEventListener('loadedmetadata', onLoaded, true);
      el.removeEventListener('error', onError, true);
      clearTimeout(timer);
    };
    const onLoaded = ()=>{ if(done) return; done = true; cleanup(); resolve(true); };
    const onError  = ()=>{ if(done) return; done = true; cleanup(); resolve(false); };
    const timer = setTimeout(()=>{ if(!done){ done=true; cleanup(); resolve(false);} }, 5000);
    el.src = `${src}?v=${Date.now()}`;
    try { el.load(); } catch {}
    el.addEventListener('loadedmetadata', onLoaded, { once:true, capture:true });
    el.addEventListener('error', onError, { once:true, capture:true });
  });
}

// ====== MYQURAN v2 ======
let jadwalSholat = {};
async function resolveMedanId() {
  const cached = localStorage.getItem(KOTA_CACHE_KEY);
  if (cached) return cached;
  const json = await fetchJSON('https://api.myquran.com/v2/sholat/kota/semua');
  const list = json?.data || [];
  const kota = list.find(k => /^kota\s*medan$/i.test(k.lokasi)) || list.find(k => /^medan$/i.test(k.lokasi));
  if (!kota) throw new Error('Kota Medan tidak ditemukan di MyQuran');
  localStorage.setItem(KOTA_CACHE_KEY, kota.id);
  return kota.id;
}
async function fetchJadwal() {
  const { y, m, d } = getWIBParts();
  const id = await resolveMedanId();
  const json = await fetchJSON(`https://api.myquran.com/v2/sholat/jadwal/${id}/${y}/${+m}/${+d}`);
  const j = json?.data?.jadwal;
  if (!j) throw new Error('Respon MyQuran tidak berisi jadwal');
  jadwalSholat = {
    subuh:   j.subuh.slice(0, 5),
    dzuhur:  j.dzuhur.slice(0, 5),
    ashar:   j.ashar.slice(0, 5),
    maghrib: j.maghrib.slice(0, 5),
    isya:    j.isya.slice(0, 5)
  };
  ['subuh','dzuhur','ashar','maghrib','isya'].forEach(k=>{
    const el = document.getElementById(k); if (el) el.textContent = jadwalSholat[k];
  });
  setStatus('Jadwal dimuat');
}

// ====== CLOCK + PEMICU AUDIO (WIB) ======
let elClock, adzanAudio, indoAudio;
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';
let lastClockText = '';

function updateClockAndTriggers() {
  const { hhmmss, hhmm, ymd } = getWIBParts();

  if (!elClock) elClock = document.getElementById('current-time');
  if (elClock && hhmmss !== lastClockText) {
    elClock.textContent = hhmmss;
    lastClockText = hhmmss;
  }

  // Indonesia Raya 09:59 (sekali per hari)
  const lastIndo = localStorage.getItem(LAST_INDONESIA_KEY);
  if (hhmm === '09:59' && lastIndo !== ymd) {
    if (!indoAudio) indoAudio = document.getElementById('indonesia-raya');
    playLagu(indoAudio).then(()=>{
      localStorage.setItem(LAST_INDONESIA_KEY, ymd);
      setStatus('Indonesia Raya 09:59');
    }).catch(()=>{});
  }

  // Adzan tepat waktu (hindari dobel dengan kunci ymd_key)
  for (const key in jadwalSholat) {
    if (jadwalSholat[key] === hhmm && lastPlayedAdzanKey !== `${ymd}_${key}`) {
      if (!adzanAudio) adzanAudio = document.getElementById('adzan-audio');
      playLagu(adzanAudio).then(()=>{
        lastPlayedAdzanKey = `${ymd}_${key}`;
        localStorage.setItem(LAST_ADZAN_KEY, lastPlayedAdzanKey);
        setStatus(`Adzan ${key} ${hhmm}`);
      }).catch(()=>{});
    }
  }
}

// ====== LOOP (ter-align detik) ======
let tickTimer = null;
function scheduleNextTick(){
  clearTimeout(tickTimer);
  const ms = 1000 - (Date.now() % 1000) + 5;
  tickTimer = setTimeout(() => {
    try { updateClockAndTriggers(); } finally { scheduleNextTick(); }
  }, ms);
}

// ====== AUDIO: direct play + remote unlock (luas) ======
async function playLagu(audioEl) {
  try {
    audioEl.load?.();                  // beberapa TV perlu eksplisit load
    audioEl.loop = false;
    audioEl.muted = false;
    audioEl.currentTime = 0;
    audioEl.volume = 1;
    await audioEl.play();              // langsung play (tanpa guard)
    console.log('▶️ Play:', audioEl.id);
  } catch (e) {
    console.warn('⚠️ Autoplay gagal:', e);
    setStatus('Perlu tekan OK/Enter pada remote untuk aktifkan suara');
  }
}

// Unlock sekali (tanpa bunyi): prime muted sebentar untuk buka policy TV
function unlockOnce(){
  const ids = ['adzan-audio', 'indonesia-raya'];
  ids.forEach(id=>{
    const a = document.getElementById(id);
    if (!a) return;
    try {
      a.load?.();
      a.muted = true;
      a.play().then(()=>{
        setTimeout(()=>{
          try { a.pause(); a.currentTime = 0; a.muted = false; } catch {}
        }, 120); // cukup untuk “unlock” tanpa terdengar
      }).catch(()=>{});
    } catch {}
  });
  setStatus('Audio siap (unlock via remote)');
}
['keydown','keyup','click','pointerup'].forEach(ev=>{
  window.addEventListener(ev, unlockOnce, { once: true, passive: true, capture: true });
  document.addEventListener(ev, unlockOnce, { once: true, passive: true, capture: true });
});

// ====== WAKE LOCK + KEEP ALIVE ======
let wakeLock = null;
async function requestWakeLock(){
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => setStatus('Wake Lock lepas'));
      setStatus('Wake Lock aktif');
    }
  } catch {}
}
// keepAlive: “sentil” video tiap 9 menit (tanpa ganggu) & re-acquire wakelock
function keepAlive(){
  try {
    const v = document.getElementById('bg-video');
    if (v && v.paused) v.play().catch(()=>{});
  } catch {}
  requestWakeLock();
}
setInterval(keepAlive, 9*60*1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    requestWakeLock();
    updateClockAndTriggers(); // hanya update, TANPA menjadwalkan loop baru
  }
});

// ====== UTIL: reset kunci via query string ======
function maybeResetKeys(){
  const qp = new URLSearchParams(location.search);
  if (qp.get('resetKeys') === '1') {
    localStorage.removeItem(LAST_ADZAN_KEY);
    localStorage.removeItem(LAST_INDONESIA_KEY);
    setStatus('Kunci harian direset');
  }
}

// ====== BOOT ======
let __BOOTED__ = false;
async function boot(){
  if (__BOOTED__) return;
  __BOOTED__ = true;

  elStatus   = document.getElementById('status-pill');
  elClock    = document.getElementById('current-time');
  adzanAudio = document.getElementById('adzan-audio');
  indoAudio  = document.getElementById('indonesia-raya');

  setStatus('Init…');
  maybeResetKeys();
  await loadVideo();

  // Siapkan audio dengan kandidat paling kompatibel
  if (adzanAudio) {
    const ok = await ensureAudioCompat(adzanAudio, ADZAN_CANDIDATES);
    setStatus(ok ? 'Audio Adzan siap' : 'Audio Adzan tidak kompatibel');
  }
  if (indoAudio) {
    const ok2 = await ensureAudioCompat(indoAudio, INDO_CANDIDATES);
    setStatus(ok2 ? 'Audio Indonesia Raya siap' : 'Audio Indonesia Raya tidak kompatibel');
  }

  await fetchJadwal();
  await requestWakeLock();

  updateClockAndTriggers();
  scheduleNextTick();

  // refresh hari baru 00:10 WIB
  setInterval(async ()=>{
    const { hh, mm } = getWIBParts();
    if (hh === '00' && mm === '10') {
      await fetchJadwal();
      await loadVideo();
      location.reload();
    }
  }, 30000);

  // --- OPSIONAL: mode uji di TV ---
  const qp = new URLSearchParams(location.search);
  if (qp.get('test') === 'adzan5') {
    setStatus('Mode uji: Adzan 5 detik (tekan OK jika diminta)');
    setTimeout(()=>{ try{ playLagu(document.getElementById('adzan-audio')); }catch{} }, 5000);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
