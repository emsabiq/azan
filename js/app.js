// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos'; // folder video di repo
// Penamaan video harian: videos/YYYY-MM-DD.mp4 (zona WIB)
// Fallback berurutan: latest.mp4 -> default.mp4 (di folder yang sama)

const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';

// ====== FEATURE/FALLBACK UNTUK TV LAWAS ======
document.addEventListener('DOMContentLoaded', () => {
  // Deteksi dukungan backdrop-filter (banyak TV lawas tidak support)
  const lackBackdrop = !(window.CSS && CSS.supports && (CSS.supports('backdrop-filter','blur(4px)') || CSS.supports('-webkit-backdrop-filter','blur(4px)')));
  if (lackBackdrop) document.documentElement.classList.add('no-bdf');

  // Mode TV otomatis (atau pakai ?tv=1 di URL untuk memaksa)
  const isTV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('tv');
  if (isTV) document.documentElement.classList.add('tv-mode');
});

// ====== UTIL WAKTU WIB ======
function getWIBParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const pick = t => parts.find(p => p.type === t)?.value;
  return {
    y: pick('year'), m: pick('month'), d: pick('day'),
    hh: pick('hour'), mm: pick('minute'), ss: pick('second'),
    hhmm: `${pick('hour')}:${pick('minute')}`,
    hhmmss: `${pick('hour')}:${pick('minute')}:${pick('second')}`,
    ymd: `${pick('year')}-${pick('month')}-${pick('day')}`
  };
}

// ====== VIDEO LOADER (TV-SAFE, NO HEAD) ======
async function loadVideo() {
  const el = document.getElementById('bg-video');
  if (!el) return;

  // Kandidat berurutan (hari ini -> latest -> default)
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

  // Jika semua gagal, kosongkan video & biarkan widget saja
  el.removeAttribute('src');
  try { el.load?.(); } catch {}
  setStatus('Video tidak didukung — hanya widget aktif');
}

function tryAttachVideo(el, src) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('error', onError);
      if (timer) clearTimeout(timer);
    };
    const onLoaded = () => {
      if (done) return; done = true; cleanup();
      // Siapkan parameter autoplay
      el.autoplay = true; el.muted = true; el.loop = true; el.playsInline = true;
      el.play().catch(()=>{ /* beberapa TV butuh waktu, abaikan */ });
      resolve(true);
    };
    const onError = () => {
      if (done) return; done = true; cleanup();
      resolve(false);
    };

    // Timeout untuk menghindari hang pada TV lambat
    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve(false); }
    }, 6000);

    // Pasang source + cache-bust
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
    subuh: j.subuh.slice(0, 5),
    dzuhur: j.dzuhur.slice(0, 5),
    ashar: j.ashar.slice(0, 5),
    maghrib: j.maghrib.slice(0, 5),
    isya: j.isya.slice(0, 5)
  };
  // isi widget
  ['subuh','dzuhur','ashar','maghrib','isya'].forEach(k=>{
    const el = document.getElementById(k); if (el) el.textContent = jadwalSholat[k];
  });
  setStatus('Jadwal dimuat');
}

// ====== CLOCK + PEMICU AUDIO ======
const elClock  = document.getElementById('current-time');
const elStatus = document.getElementById('status-pill');
const adzanAudio = document.getElementById('adzan-audio');
const indoAudio  = document.getElementById('indonesia-raya');

let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';

function setStatus(text){
  if (elStatus) elStatus.textContent = text;
  try { console.log('[STATUS]', text); } catch {}
}

function updateClockAndTriggers() {
  const { hhmmss, hhmm, ymd } = getWIBParts();
  if (elClock) elClock.textContent = hhmmss;

  // Indonesia Raya pukul 09:59 sekali per hari
  const lastIndo = localStorage.getItem(LAST_INDONESIA_KEY);
  if (hhmm === '09:59' && lastIndo !== ymd) {
    playLagu(indoAudio).then(()=>{
      localStorage.setItem(LAST_INDONESIA_KEY, ymd);
      setStatus('Indonesia Raya 09:59');
    }).catch(()=>{ /* diamkan */ });
  }

  // Adzan
  for (const key in jadwalSholat) {
    if (jadwalSholat[key] === hhmm && lastPlayedAdzanKey !== `${ymd}_${key}`) {
      playLagu(adzanAudio).then(()=>{
        lastPlayedAdzanKey = `${ymd}_${key}`;
        localStorage.setItem(LAST_ADZAN_KEY, lastPlayedAdzanKey);
        setStatus(`Adzan ${key} ${hhmm}`);
      }).catch(()=>{ /* diamkan */ });
    }
  }
}

// ====== AUTOPLAY PRIMING & UNLOCK ======
let soundUnlocked = false;
async function primeAutoplay() {
  try {
    adzanAudio.loop = true;
    adzanAudio.muted = true;
    await adzanAudio.play();
    soundUnlocked = true;
    setStatus('Audio siap (primed)');
    removeUnlockHandlers();
  } catch (e) {
    setStatus('Aktifkan suara: sentuh/klik/gerakkan');
    addUnlockHandlers();
  }
}
function addUnlockHandlers() {
  const once = async () => { try { await primeAutoplay(); } finally { removeUnlockHandlers(); } };
  window.addEventListener('pointerdown', once, { once:true });
  window.addEventListener('touchstart', once, { once:true });
  window.addEventListener('keydown', once, { once:true });
  window.addEventListener('wheel', once, { once:true, passive:true });
  window.addEventListener('pointermove', once, { once:true });
}
function removeUnlockHandlers() {
  window.onpointerdown = window.ontouchstart = window.onkeydown = window.onwheel = window.onpointermove = null;
}
async function playLagu(audioEl) {
  try {
    if (!soundUnlocked) await primeAutoplay();
    audioEl.loop = false; audioEl.muted = false; audioEl.currentTime = 0; audioEl.volume = 1;
    if (audioEl.paused) await audioEl.play();
  } catch (e) { console.warn('Play blocked:', e); throw e; }
}

// ====== WAKE LOCK (agar layar tidak sleep, jika didukung) ======
let wakeLock = null;
async function requestWakeLock(){
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => setStatus('Wake Lock lepas'));
      setStatus('Wake Lock aktif');
    }
  } catch(e){ console.warn('WakeLock gagal:', e); }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { requestWakeLock(); updateClockAndTriggers(); }
});

// ====== SCHEDULERS ======
async function boot(){
  setStatus('Init…');
  await loadVideo();
  await fetchJadwal();
  await primeAutoplay();
  await requestWakeLock();

  // clock & triggers
  setInterval(updateClockAndTriggers, 1000);

  // refresh jadwal & video tiap hari 00:10 WIB
  setInterval(async ()=>{
    const { hh, mm } = getWIBParts();
    if (hh === '00' && mm === '10') {
      await fetchJadwal();
      await loadVideo();
      location.reload(); // safest untuk signage
    }
  }, 30_000);
}
boot();
