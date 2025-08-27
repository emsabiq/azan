// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos';
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

// ====== UTIL WAKTU WIB (tanpa Intl, aman di TV) ======
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function getWIBParts(now = new Date()){
  // WIB = UTC+7 → hitung manual biar kompatibel TV lawas
  const utcMs = now.getTime() + now.getTimezoneOffset()*60000;
  const wib = new Date(utcMs + 7*3600*1000);
  const y  = wib.getUTCFullYear();
  const m  = pad2(wib.getUTCMonth()+1);
  const d  = pad2(wib.getUTCDate());
  const hh = pad2(wib.getUTCHours());
  const mm = pad2(wib.getUTCMinutes());
  const ss = pad2(wib.getUTCSeconds());
  return { y, m, d, hh, mm, ss, hhmm: `${hh}:${mm}`, hhmmss: `${hh}:${mm}:${ss}`, ymd: `${y}-${m}-${d}` };
}

// ====== VIDEO LOADER (TV-SAFE, tanpa HEAD) ======
async function loadVideo() {
  const el = document.getElementById('bg-video');
  if (!el) return;

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

  // Semua gagal → sembunyikan video agar tidak “layar hitam”
  safeHideVideo(el);
  setStatus('Video gagal dimuat — hanya widget aktif');
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
      el.autoplay = true; el.muted = true; el.loop = true; el.playsInline = true;
      el.play().catch(()=>{});
      resolve(true);
    };
    const onError = () => { if (done) return; done = true; cleanup(); resolve(false); };

    const timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(false); } }, 6000);

    el.style.display = 'block';
    el.src = `${src}?v=${Date.now()}`;  // cache-bust
    el.addEventListener('loadedmetadata', onLoaded, { once:true });
    el.addEventListener('error', onError, { once:true });
  });
}
function safeHideVideo(el){
  try { el.pause(); } catch {}
  el.removeAttribute('src');
  try { el.load?.(); } catch {}
  el.style.display = 'none';
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
  ['subuh','dzuhur','ashar','maghrib','isya'].forEach(k=>{
    const el = document.getElementById(k); if (el) el.textContent = jadwalSholat[k];
  });
  setStatus('Jadwal dimuat');
}

// ====== CLOCK + PEMICU AUDIO ======
let elClock, elStatus, adzanAudio, indoAudio;
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';

function setStatus(text){
  if (!elStatus) elStatus = document.getElementById('status-pill');
  if (elStatus) elStatus.textContent = text;
  try { console.log('[STATUS]', text); } catch {}
}

function updateClockAndTriggers() {
  const { hhmmss, hhmm, ymd } = getWIBParts();

  if (!elClock) elClock = document.getElementById('current-time');
  if (elClock) elClock.textContent = hhmmss;

  // Indonesia Raya 09:59 (sekali per hari)
  const lastIndo = localStorage.getItem(LAST_INDONESIA_KEY);
  if (hhmm === '09:59' && lastIndo !== ymd) {
    playLagu(indoAudio).then(()=>{
      localStorage.setItem(LAST_INDONESIA_KEY, ymd);
      setStatus('Indonesia Raya 09:59');
    }).catch(()=>{});
  }

  // Adzan
  for (const key in jadwalSholat) {
    if (jadwalSholat[key] === hhmm && lastPlayedAdzanKey !== `${ymd}_${key}`) {
      playLagu(adzanAudio).then(()=>{
        lastPlayedAdzanKey = `${ymd}_${key}`;
        localStorage.setItem(LAST_ADZAN_KEY, lastPlayedAdzanKey);
        setStatus(`Adzan ${key} ${hhmm}`);
      }).catch(()=>{});
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

// ====== WAKE LOCK ======
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

// ====== BOOT ======
async function boot(){
  // Bind DOM setelah siap
  elClock    = document.getElementById('current-time');
  elStatus   = document.getElementById('status-pill');
  adzanAudio = document.getElementById('adzan-audio');
  indoAudio  = document.getElementById('indonesia-raya');

  setStatus('Init…');
  await loadVideo();
  await fetchJadwal();
  await primeAutoplay();
  await requestWakeLock();

  // clock & triggers
  updateClockAndTriggers();
  setInterval(updateClockAndTriggers, 1000);

  // refresh 00:10 WIB untuk hari baru
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
