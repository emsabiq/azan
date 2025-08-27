// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos';
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';

// ====== DETEKSI TV / FALLBACK CSS ======
const IS_TV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
           || new URLSearchParams(location.search).has('tv');

document.addEventListener('DOMContentLoaded', () => {
  const lackBackdrop = !(window.CSS && CSS.supports &&
    (CSS.supports('backdrop-filter','blur(4px)') || CSS.supports('-webkit-backdrop-filter','blur(4px)')));
  if (lackBackdrop) document.documentElement.classList.add('no-bdf');
  if (IS_TV) document.documentElement.classList.add('tv-mode');
});

// ===== WIB HELPERS =====
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function getWIBParts(now = new Date()){
  const localOffsetMin = -now.getTimezoneOffset();
  const deltaMin = 420 - localOffsetMin; // 420 = +7 jam
  const t = new Date(now.getTime() + deltaMin * 60000);
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
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onLoaded = () => { if (done) return; done = true; cleanup(); el.play().catch(()=>{}); resolve(true); };
    const onError  = () => { if (done) return; done = true; cleanup(); resolve(false); };
    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, 6000);

    el.src = `${src}?v=${Date.now()}`;
    el.addEventListener('loadedmetadata', onLoaded, { once:true });
    el.addEventListener('error', onError, { once:true });
  });
}

// ====== MYQURAN v2 ======
let jadwalSholat = {};
async function resolveMedanId() {
  const cached = localStorage.getItem(KOTA_CACHE_KEY);
  if (cached) return cached;
  const res = await fetch('https://api.myquran.com/v2/sholat/kota/semua');
  const json = await res.json();
  const list = json?.data || [];
  const kota = list.find(k => /^kota\s*medan$/i.test(k.lokasi)) || list.find(k => /^medan$/i.test(k.lokasi));
  if (!kota) throw new Error('Kota Medan tidak ditemukan di MyQuran');
  localStorage.setItem(KOTA_CACHE_KEY, kota.id);
  return kota.id;
}
async function fetchJadwal() {
  const { y, m, d } = getWIBParts();
  const id = await resolveMedanId();
  const url = `https://api.myquran.com/v2/sholat/jadwal/${id}/${y}/${+m}/${+d}`;
  const res = await fetch(url);
  const json = await res.json();
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

// ====== AUDIO: direct play + remote unlock ======
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
    setStatus('Perlu tekan OK pada remote untuk aktifkan suara');
  }
}

// Unlock sekali (tidak memutar adzan spontan): prime sebentar dalam kondisi muted
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
        }, 120); // cukup untuk “unlock” policy, tanpa bunyi
      }).catch(()=>{});
    } catch {}
  });
  setStatus('Audio siap (unlock via remote)');
}
// tangkap berbagai jenis input remote (sekali saja)
['keydown','keyup','click','pointerup'].forEach(ev=>{
  document.addEventListener(ev, unlockOnce, { once: true, passive: true });
});

// ====== WAKE LOCK ======
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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    requestWakeLock();
    updateClockAndTriggers(); // hanya update, TANPA menjadwalkan loop baru
  }
});

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
  await loadVideo();
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

  // --- OPSIONAL: tes cepat di TV ---
  const qp = new URLSearchParams(location.search);
  if (qp.get('test') === 'adzan5') {
    setStatus('Mode uji: Adzan 5 detik');
    setTimeout(()=>{ try{ playLagu(document.getElementById('adzan-audio')); }catch{} }, 5000);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
