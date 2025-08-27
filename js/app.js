// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos'; // folder video di repo (videos/YYYY-MM-DD.mp4)
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';

// ====== FEATURE/FALLBACK UNTUK TV LAWAS ======
document.addEventListener('DOMContentLoaded', () => {
  const lackBackdrop = !(window.CSS && CSS.supports &&
    (CSS.supports('backdrop-filter','blur(4px)') || CSS.supports('-webkit-backdrop-filter','blur(4px)')));
  if (lackBackdrop) document.documentElement.classList.add('no-bdf');

  const isTV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
             || new URLSearchParams(location.search).has('tv');
  if (isTV) document.documentElement.classList.add('tv-mode');
});

// ====== UTIL WAKTU WIB (BENAR-BENAR KEBAL TIMEZONE) ======
function getWIBParts(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  // Ambil komponen UTC saat ini
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth();      // 0..11
  const D = d.getUTCDate();
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const s = d.getUTCSeconds();

  // Geser +7 jam di RANAH UTC
  const wibMs = Date.UTC(Y, M, D, h + 7, m, s);
  const w = new Date(wibMs);

  const y  = w.getUTCFullYear();
  const mo = pad(w.getUTCMonth() + 1);
  const dy = pad(w.getUTCDate());
  const hh = pad(w.getUTC_h = w.getUTCHours());
  const mm = pad(w.getUTCMinutes());
  const ss = pad(w.getUTCSeconds());

  return {
    y, m: mo, d: dy,
    hh, mm, ss,
    hhmm:   `${hh}:${mm}`,
    hhmmss: `${hh}:${mm}:${ss}`,
    ymd:    `${y}-${mo}-${dy}`
  };
}

// ====== STATUS ======
let elStatus = null;
function setStatus(text){
  if (!elStatus) elStatus = document.getElementById('status-pill');
  if (elStatus) elStatus.textContent = text;
}

// ====== VIDEO LOADER (Tizen-safe, tanpa HEAD) ======
async function loadVideo() {
  const el = document.getElementById('bg-video');
  if (!el) return;

  try {
    el.disablePictureInPicture = true;
    el.setAttribute('disablepictureinpicture','');
    el.disableRemotePlayback = true;
    el.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');
    el.playsInline = true; el.setAttribute('playsinline','');
    el.autoplay = true; el.muted = true; el.loop = true; el.preload = 'auto';
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
  setStatus('Video tidak didukung — hanya widget aktif');
}

function tryAttachVideo(el, src) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onLoaded = () => {
      if (done) return; done = true; cleanup();
      el.play().catch(()=>{});
      resolve(true);
    };
    const onError = () => { if (done) return; done = true; cleanup(); resolve(false); };

    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, 8000);

    // cache-bust di banyak environment TV tetap aman
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
    subuh:   j.subuh.slice(0,5),
    dzuhur:  j.dzuhur.slice(0,5),
    ashar:   j.ashar.slice(0,5),
    maghrib: j.maghrib.slice(0,5),
    isya:    j.isya.slice(0,5)
  };
  ['subuh','dzuhur','ashar','maghrib','isya'].forEach(k=>{
    const el = document.getElementById(k); if (el) el.textContent = jadwalSholat[k];
  });
  setStatus('Jadwal dimuat');
}

// ====== CLOCK + PEMICU AUDIO ======
let elClock, adzanAudio, indoAudio;
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';

function updateClockAndTriggers() {
  const { hhmmss, hhmm, ymd } = getWIBParts();

  if (!elClock) elClock = document.getElementById('current-time');
  if (elClock) elClock.textContent = hhmmss;

  const lastIndo = localStorage.getItem(LAST_INDONESIA_KEY);
  if (hhmm === '09:59' && lastIndo !== ymd) {
    if (!indoAudio) indoAudio = document.getElementById('indonesia-raya');
    playLagu(indoAudio).then(()=>{
      localStorage.setItem(LAST_INDONESIA_KEY, ymd);
      setStatus('Indonesia Raya 09:59');
    }).catch(()=>{});
  }

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

// ====== TICK (anti-drift; satu-satunya updater) ======
let tickTimer = null;
function startClock() {
  if (tickTimer) clearTimeout(tickTimer);
  const tick = () => {
    updateClockAndTriggers();
    tickTimer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();
}

// ====== AUDIO UNLOCK ======
let soundUnlocked = false;
async function primeAutoplay() {
  try {
    if (!adzanAudio) adzanAudio = document.getElementById('adzan-audio');
    adzanAudio.loop = true;
    adzanAudio.muted = true;
    await adzanAudio.play();
    soundUnlocked = true;
    setStatus('Audio siap (primed)');
    removeUnlockHandlers();
  } catch {
    setStatus('Aktifkan suara: sentuh/klik/gerakkan');
    addUnlockHandlers();
  }
}
function addUnlockHandlers() {
  const once = async () => { try { await primeAutoplay(); } finally { removeUnlockHandlers(); } };
  window.addEventListener('pointerdown', once, { once:true });
  window.addEventListener('touchstart', once, { once:true });
  window.addEventListener('keydown', once, { once:true });
}
function removeUnlockHandlers() {
  window.onpointerdown = window.ontouchstart = window.onkeydown = null;
}
async function playLagu(audioEl) {
  try {
    if (!soundUnlocked) await primeAutoplay();
    audioEl.loop = false; audioEl.muted = false; audioEl.currentTime = 0; audioEl.volume = 1;
    if (audioEl.paused) await audioEl.play();
  } catch {}
}

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
  if (!document.hidden) { requestWakeLock(); updateClockAndTriggers(); }
});

// ====== BOOT ======
async function boot(){
  elStatus   = document.getElementById('status-pill');
  elClock    = document.getElementById('current-time');
  adzanAudio = document.getElementById('adzan-audio');
  indoAudio  = document.getElementById('indonesia-raya');

  setStatus('Init…');
  await loadVideo();
  await fetchJadwal();
  await primeAutoplay();
  await requestWakeLock();

  updateClockAndTriggers();
  startClock();

  // refresh jadwal & video tiap hari 00:10 WIB
  setInterval(async ()=>{
    const { hh, mm } = getWIBParts();
    if (hh === '00' && mm === '10') {
      await fetchJadwal();
      await loadVideo();
      location.reload();
    }
  }, 30000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
