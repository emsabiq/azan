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

// ====== UTIL WAKTU WIB ======
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function getWIBParts(now = new Date()){
  // WIB = UTC+7
  const utcMs = now.getTime() + now.getTimezoneOffset()*60000;
  const w = new Date(utcMs + 7*3600*1000);
  const y  = w.getUTCFullYear();
  const m  = pad2(w.getUTCMonth()+1);
  const d  = pad2(w.getUTCDate());
  const hh = pad2(w.getUTCHours());
  const mm = pad2(w.getUTCMinutes());
  const ss = pad2(w.getUTCSeconds());
  return { y, m, d, hh, mm, ss, hhmm:`${hh}:${mm}`, hhmmss:`${hh}:${mm}:${ss}`, ymd:`${y}-${m}-${d}` };
}

// ====== STATUS ======
function setStatus(text){
  const elStatus = document.getElementById('status-pill');
  if (elStatus) elStatus.textContent = text;
}

// ====== VIDEO LOADER ======
function ensurePiPOff(video){
  try {
    video.disablePictureInPicture = true;
    video.setAttribute('disablepictureinpicture','');
    video.disableRemotePlayback = true;
    video.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');
  } catch {}
}

async function loadVideo() {
  const video = document.getElementById('bg-video');
  if (!video) return;

  video.autoplay = true; video.muted = true; video.loop = true;
  video.playsInline = true; video.setAttribute('playsinline',''); video.preload = 'auto';
  ensurePiPOff(video);

  const { ymd } = getWIBParts();
  const candidates = [
    `${VIDEO_BASE}/${ymd}.mp4`,
    `${VIDEO_BASE}/latest.mp4`,
    `${VIDEO_BASE}/default.mp4`
  ];

  for (const src of candidates) {
    const ok = await attachSourceAndPlay(video, src);
    if (ok) {
      setStatus('Video siap');
      video.style.display = 'block';
      setInterval(()=>{ if (video.paused && video.readyState >= 2) video.play().catch(()=>{}); }, 15000);
      return;
    }
  }

  safeHideVideo(video);
  setStatus('Video gagal dimuat — hanya widget aktif');
}

function attachSourceAndPlay(video, src){
  return new Promise((resolve) => {
    while (video.firstChild) video.removeChild(video.firstChild);

    const s1 = document.createElement('source');
    s1.src = src;
    s1.type = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
    const s2 = document.createElement('source');
    s2.src = src;
    s2.type = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    video.appendChild(s1); video.appendChild(s2);

    let done = false;
    const finish = ok => { if (done) return; done = true; cleanup(); resolve(ok); };
    const cleanup = () => { Object.keys(handlers).forEach(ev => video.removeEventListener(ev, handlers[ev])); clearTimeout(timer); };

    const handlers = {
      loadeddata: () => finish(true),
      canplay:    () => { video.play().catch(()=>{}); },
      playing:    () => finish(true),
      error:      () => finish(false)
    };

    const timer = setTimeout(() => finish(false), IS_TV ? 20000 : 10000);
    Object.keys(handlers).forEach(ev => video.addEventListener(ev, handlers[ev], { once:true }));

    try { video.load(); } catch {}
    video.play().catch(()=>{});
    setTimeout(() => { if (video.paused) showManualStart(video); }, 2500);
  });
}

function showManualStart(video){
  if (document.getElementById('start-video-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'start-video-btn';
  btn.textContent = 'Mulai Video';
  Object.assign(btn.style, {
    position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
    zIndex: 10000, padding:'10px 16px', borderRadius:'10px',
    background:'rgba(20,52,46,.85)', color:'#fff', border:'1px solid rgba(255,255,255,.2)',
    fontWeight:'700', cursor:'pointer'
  });
  btn.onclick = () => { video.play().then(()=>btn.remove()).catch(()=>{}); };
  document.body.appendChild(btn);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      video.play().then(()=>{ try{btn.remove();}catch{}; }).catch(()=>{});
    }
  }, { once:true });
}

function safeHideVideo(video){
  try { video.pause(); } catch {}
  while (video.firstChild) video.removeChild(video.firstChild);
  try { video.load?.(); } catch {}
  video.style.display = 'none';
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

// ====== CLOCK + PEMICU AUDIO ======
let adzanAudio, indoAudio;
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY) || '';

function updateClockAndTriggers() {
  const { hhmmss, hhmm, ymd } = getWIBParts();

  // SELALU re-bind elemen clock
  const elClock = document.getElementById('current-time');
  if (elClock) elClock.textContent = hhmmss;

  const lastIndo = localStorage.getItem(LAST_INDONESIA_KEY);
  if (hhmm === '09:59' && lastIndo !== ymd) {
    playLagu(indoAudio).then(()=>{
      localStorage.setItem(LAST_INDONESIA_KEY, ymd);
      setStatus('Indonesia Raya 09:59');
    }).catch(()=>{});
  }

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

// Anti-throttle: loop berbasis timeout
function startClockLoop(){
  function tick(){
    updateClockAndTriggers();
    const delay = 1000 - (Date.now() % 1000) + 5;
    setTimeout(tick, delay);
  }
  tick();
}

// ====== AUDIO UNLOCK ======
let soundUnlocked = false;
async function primeAutoplay() {
  try {
    adzanAudio.loop = true;
    adzanAudio.muted = true;
    await adzanAudio.play();
    soundUnlocked = true;
    setStatus('Audio siap (primed)');
  } catch (e) {
    setStatus('Aktifkan suara: sentuh/klik/OK');
  }
}
async function playLagu(audioEl) {
  try {
    if (!soundUnlocked) await primeAutoplay();
    audioEl.loop = false; audioEl.muted = false; audioEl.currentTime = 0; audioEl.volume = 1;
    if (audioEl.paused) await audioEl.play();
  } catch {}
}

// ====== WAKE LOCK ======
async function requestWakeLock(){
  try {
    if ('wakeLock' in navigator) {
      const wl = await navigator.wakeLock.request('screen');
      wl.addEventListener('release', () => setStatus('Wake Lock lepas'));
      setStatus('Wake Lock aktif');
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { requestWakeLock(); updateClockAndTriggers(); }
});

// ====== BOOT ======
async function boot(){
  adzanAudio = document.getElementById('adzan-audio');
  indoAudio  = document.getElementById('indonesia-raya');

  setStatus('Init…');
  await loadVideo();
  await fetchJadwal();
  await primeAutoplay();
  await requestWakeLock();

  // Clock loop
  updateClockAndTriggers();
  startClockLoop();

  // Refresh 00:10 WIB untuk hari baru
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
