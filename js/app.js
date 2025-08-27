// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos';
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';

// ====== DETEKSI TV / FALLBACK CSS ======
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
  // WIB = UTC+7 (tidak tergantung zona waktu perangkat)
  const utcMs = now.getTime() + now.getTimezoneOffset()*60000;
  const w = new Date(utcMs + 7*3600*1000);
  const y  = w.getUTCFullYear();
  const m  = pad2(w.getUTCMonth()+1);
  const d  = pad2(w.getUTCDate());
  const hh = pad2(w.getUTCHours());
  const mm = pad2(w.getUTCMinutes());
  const ss = pad2(w.getUTCSeconds());
  return { y, m, d, hh, mm, ss,
           hhmm: `${hh}:${mm}`,
           hhmmss: `${hh}:${mm}:${ss}`,
           ymd: `${y}-${m}-${d}` };
}

// ====== VIDEO LOADER (TV-safe: no HEAD, no querystring) ======
const IS_TV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
            || new URLSearchParams(location.search).has('tv');

async function loadVideo() {
  const el = document.getElementById('bg-video');
  if (!el) return;

  const { ymd } = getWIBParts();
  const candidates = [
    `${VIDEO_BASE}/${ymd}.mp4`,
    `${VIDEO_BASE}/latest.mp4`,
    `${VIDEO_BASE}/default.mp4`
  ];

  // Set autoplay props **sebelum** src (penting di TV)
  el.autoplay = true;
  el.muted = true;
  el.loop = true;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.preload = 'auto';

  for (const src of candidates) {
    const ok = await tryAttachVideo(el, src);
    if (ok) {
      setStatus('Video siap');
      el.style.display = 'block';
      // keep-alive: beberapa TV pause sendiri
      setInterval(() => { if (el.src && el.paused) el.play().catch(()=>{}); }, 15000);
      return;
    }
  }

  // Semua gagal → sembunyikan video agar tidak “layar hitam”
  safeHideVideo(el);
  setStatus('Video gagal dimuat — hanya widget aktif');
}

function tryAttachVideo(el, src) {
  return new Promise((resolve) => {
    let done = false;
    const finish = ok => { if (done) return; done = true; cleanup(); resolve(ok); };
    const cleanup = () => {
      ['loadedmetadata','loadeddata','canplay','playing','error','stalled','suspend','emptied']
        .forEach(ev => el.removeEventListener(ev, handlers[ev]));
      if (timer) clearTimeout(timer);
    };
    const handlers = {
      loadedmetadata: () => { el.play().catch(()=>{}); },
      loadeddata:     () => finish(true),
      canplay:        () => finish(true),
      playing:        () => finish(true),
      stalled:        () => {},           // biarkan timeout yang memutuskan
      suspend:        () => {},
      emptied:        () => {},
      error:          () => finish(false)
    };
    const timer = setTimeout(() => finish(false), IS_TV ? 18000 : 9000);

    Object.keys(handlers).forEach(ev => el.addEventListener(ev, handlers[ev], { once: ev!=='stalled' && ev!=='suspend' }));

    // Pasang sumber TANPA query string
    el.style.display = 'block';
    try { el.pause(); } catch {}
    el.removeAttribute('src');
    try { el.load?.(); } catch {}
    el.src = src;
    try { el.load?.(); } catch {}
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
  if (!res.ok) throw new Error('HTTP ' + res.status);
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

// Retry otomatis untuk jadwal (jaringan TV kadang flakey)
async function fetchJadwalWithRetry(tries=0){
  try { await fetchJadwal(); }
  catch(e){
    setStatus('Jadwal gagal, mencoba ulang…');
    if (tries < 3) setTimeout(()=>fetchJadwalWithRetry(tries+1), (tries+1)*5000);
  }
}

// ====== CLOCK + PEMICU AUDIO ======
let elClock, elStatus, adzanAudio, indoAudio;
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';

function setStatus(text){
  if (!elStatus) elStatus = document.getElementById('status-pill');
  if (elStatus) elStatus.textContent = text;
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

// Tick per detik dengan koreksi drift (lebih stabil di TV)
let tickTimer = null;
function scheduleNextTick(){
  const ms = 1000 - (Date.now() % 1000) + 5; // +5ms buffer
  tickTimer = setTimeout(() => {
    updateClockAndTriggers();
    scheduleNextTick();
  }, ms);
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
  } catch (e) { /* diam */ }
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
  } catch(e){ /* diam */ }
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
  await fetchJadwalWithRetry();
  await primeAutoplay();
  await requestWakeLock();

  // clock & triggers
  updateClockAndTriggers();  // tampilkan segera
  scheduleNextTick();        // lalu detik demi detik

  // refresh 00:10 WIB untuk hari baru (jadwal & video)
  setInterval(async ()=>{
    const { hh, mm } = getWIBParts();
    if (hh === '00' && mm === '10') {
      await fetchJadwalWithRetry();
      await loadVideo();
      location.reload();
    }
  }, 30000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
