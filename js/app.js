// ====== KONFIGURASI ======
const VIDEO_BASE = 'videos';
const KOTA_CACHE_KEY = 'myq_kota_medan_id';
const LAST_INDONESIA_KEY = 'lastPlayedIndonesia';
const LAST_ADZAN_KEY = 'lastPlayedAdzanKey';

// Deteksi TV (opsional)
const IS_TV = /Tizen|Web0S|WebOS|SmartTV|Hisense|AOSP|Android TV/i.test(navigator.userAgent)
           || new URLSearchParams(location.search).has('tv');

document.addEventListener('DOMContentLoaded', () => {
  const okBlur = (window.CSS&&CSS.supports)&& (CSS.supports('backdrop-filter','blur(4px)')||CSS.supports('-webkit-backdrop-filter','blur(4px)'));
  if (!okBlur) document.documentElement.classList.add('no-bdf');
  if (IS_TV) document.documentElement.classList.add('tv-mode');
});

// ====== WIB helper (tanpa Intl, aman di TV) ======
function pad2(n){ return n<10 ? '0'+n : ''+n; }
function getWIBParts(now=new Date()){
  // Cara paling aman: konversi ke UTC lalu tambah +7 jam (WIB).
  const utcMs = now.getTime() + now.getTimezoneOffset()*60000; // UTC ms
  const wib = new Date(utcMs + 7*3600*1000);                   // UTC+7
  const y  = wib.getUTCFullYear();
  const m  = pad2(wib.getUTCMonth()+1);
  const d  = pad2(wib.getUTCDate());
  const hh = pad2(wib.getUTCHours());
  const mm = pad2(wib.getUTCMinutes());
  const ss = pad2(wib.getUTCSeconds());
  return { y,m,d, hh,mm,ss, hhmm:`${hh}:${mm}`, hhmmss:`${hh}:${mm}:${ss}`, ymd:`${y}-${m}-${d}` };
}

// ====== STATUS ======
function setStatus(t){ const el=document.getElementById('status-pill'); if(el) el.textContent=t; }

// ====== VIDEO LOADER (Tizen-safe) ======
function ensurePiPOff(v){
  try{
    v.disablePictureInPicture = true; v.setAttribute('disablepictureinpicture','');
    v.disableRemotePlayback = true;   v.setAttribute('controlslist','nodownload noplaybackrate noremoteplayback');
  }catch{}
}
async function loadVideo(){
  const v = document.getElementById('bg-video'); if(!v) return;
  v.autoplay=true; v.muted=true; v.loop=true; v.playsInline=true; v.setAttribute('playsinline',''); v.preload='auto';
  ensurePiPOff(v);

  const { ymd } = getWIBParts();
  const sources = [
    `${VIDEO_BASE}/${ymd}.mp4`,
    `${VIDEO_BASE}/latest.mp4`,
    `${VIDEO_BASE}/default.mp4`,
  ];
  for (const src of sources){
    const ok = await attachAndTryPlay(v, src);
    if (ok){
      setStatus('Video siap');
      // keep-alive (beberapa TV suka pause sendiri)
      setInterval(()=>{ if (v.paused && v.readyState>=2) v.play().catch(()=>{}); }, 15000);
      return;
    }
  }
  // Gagal semua → sembunyikan source agar tidak layar hitam
  try{ v.pause(); }catch{}
  while(v.firstChild) v.removeChild(v.firstChild);
  try{ v.load?.(); }catch{}
  setStatus('Video gagal dimuat — hanya widget aktif');
}
function attachAndTryPlay(v, src){
  return new Promise((resolve)=>{
    while(v.firstChild) v.removeChild(v.firstChild);

    // Deklarasi codec eksplisit (Tizen picky)
    const s1=document.createElement('source'); s1.src=src; s1.type='video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
    const s2=document.createElement('source'); s2.src=src; s2.type='video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    v.appendChild(s1); v.appendChild(s2);

    let done=false;
    const finish=ok=>{ if(done) return; done=true; cleanup(); resolve(ok); };
    const cleanup=()=>{ ['loadeddata','canplay','playing','error'].forEach(ev=>v.removeEventListener(ev,handlers[ev])); clearTimeout(to); };

    const handlers={
      loadeddata: ()=>finish(true),
      canplay: ()=>{ v.play().catch(()=>{}); },
      playing: ()=>finish(true),
      error: ()=>finish(false)
    };
    const to=setTimeout(()=>finish(false), IS_TV?20000:10000);
    Object.keys(handlers).forEach(ev=>v.addEventListener(ev,handlers[ev],{once:true}));

    try{ v.load(); }catch{}
    v.play().catch(()=>{});
    // Tombol manual (OK/Enter) jika autoplay ditolak
    setTimeout(()=>{ if(v.paused) showManualStart(v); }, 2500);
  });
}
function showManualStart(v){
  if (document.getElementById('start-video-btn')) return;
  const b=document.createElement('button');
  b.id='start-video-btn'; b.textContent='Mulai Video';
  Object.assign(b.style,{position:'fixed',left:'50%',top:'50%',transform:'translate(-50%,-50%)',zIndex:10000,
    padding:'10px 16px',borderRadius:'10px',background:'rgba(20,52,46,.85)',color:'#fff',
    border:'1px solid rgba(255,255,255,.2)',fontWeight:700,cursor:'pointer'});
  b.onclick=()=>{ v.play().then(()=>b.remove()).catch(()=>{}); };
  document.body.appendChild(b);
  const onKey=(e)=>{ if(e.key==='Enter'||e.keyCode===13){ v.play().then(()=>{try{b.remove();}catch{};window.removeEventListener('keydown',onKey);}).catch(()=>{}); } };
  window.addEventListener('keydown',onKey);
}

// ====== JADWAL (MyQuran v2) ======
let jadwalSholat={};
async function resolveMedanId(){
  const c=localStorage.getItem(KOTA_CACHE_KEY); if(c) return c;
  const r=await fetch('https://api.myquran.com/v2/sholat/kota/semua'); const j=await r.json();
  const list=j?.data||[]; const kota=list.find(k=>/^kota\s*medan$/i.test(k.lokasi))||list.find(k=>/^medan$/i.test(k.lokasi));
  if(!kota) throw new Error('Kota Medan tidak ditemukan');
  localStorage.setItem(KOTA_CACHE_KEY,kota.id); return kota.id;
}
async function fetchJadwal(){
  const {y,m,d}=getWIBParts(); const id=await resolveMedanId();
  const url=`https://api.myquran.com/v2/sholat/jadwal/${id}/${y}/${+m}/${+d}`;
  const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
  const j=await r.json(); const jj=j?.data?.jadwal; if(!jj) throw new Error('Respon kosong');
  jadwalSholat={
    subuh: jj.subuh.slice(0,5), dzuhur: jj.dzuhur.slice(0,5), ashar: jj.ashar.slice(0,5),
    maghrib: jj.maghrib.slice(0,5), isya: jj.isya.slice(0,5),
  };
  ['subuh','dzuhur','ashar','maghrib','isya'].forEach(k=>{
    const el=document.getElementById(k); if(el) el.textContent=jadwalSholat[k];
  });
  setStatus('Jadwal dimuat');
}
async function fetchJadwalWithRetry(n=0){
  try{ await fetchJadwal(); }
  catch(e){ setStatus('Jadwal gagal, mencoba ulang…'); if(n<3) setTimeout(()=>fetchJadwalWithRetry(n+1),(n+1)*5000); }
}

// ====== CLOCK + TRIGGER AUDIO ======
let lastPlayedAdzanKey = localStorage.getItem(LAST_ADZAN_KEY)||'';
let adzanAudio=null, indoAudio=null;

async function primeAutoplay(){
  try{
    if(!adzanAudio) adzanAudio=document.getElementById('adzan-audio');
    adzanAudio.loop=true; adzanAudio.muted=true;
    await adzanAudio.play();
    setStatus('Audio siap (primed)');
    window.removeEventListener('pointerdown',primeAutoplay);
    window.removeEventListener('touchstart',primeAutoplay);
    window.removeEventListener('keydown',primeAutoplay);
  }catch{
    setStatus('Aktifkan suara: sentuh/klik/OK');
    window.addEventListener('pointerdown',primeAutoplay,{once:true});
    window.addEventListener('touchstart',primeAutoplay,{once:true});
    window.addEventListener('keydown',primeAutoplay,{once:true});
  }
}
async function playLagu(el){
  try{
    if(!el) return;
    await primeAutoplay();        // pastikan unlocked
    el.loop=false; el.muted=false; el.currentTime=0; el.volume=1;
    if(el.paused) await el.play();
  }catch{}
}

function updateClockAndTriggers(){
  const {hhmmss, hhmm, ymd}=getWIBParts();

  // Re-bind tiap tick (jangan cache)
  const clk=document.getElementById('current-time');
  if(clk) clk.textContent=hhmmss;

  // Pastikan elemen audio ada
  if(!adzanAudio) adzanAudio=document.getElementById('adzan-audio');
  if(!indoAudio)  indoAudio =document.getElementById('indonesia-raya');

  // Indonesia Raya 09:59 (sekali per hari)
  const lastIndo=localStorage.getItem(LAST_INDONESIA_KEY);
  if(hhmm==='09:59' && lastIndo!==ymd){
    playLagu(indoAudio).then(()=>{ localStorage.setItem(LAST_INDONESIA_KEY,ymd); setStatus('Indonesia Raya 09:59'); }).catch(()=>{});
  }

  // Adzan
  for(const key in jadwalSholat){
    if(jadwalSholat[key]===hhmm && lastPlayedAdzanKey!==`${ymd}_${key}`){
      playLagu(adzanAudio).then(()=>{
        lastPlayedAdzanKey=`${ymd}_${key}`;
        localStorage.setItem(LAST_ADZAN_KEY,lastPlayedAdzanKey);
        setStatus(`Adzan ${key} ${hhmm}`);
      }).catch(()=>{});
    }
  }
}

// Loop jam anti-drift (lebih stabil di TV dibanding setInterval)
(function startClock(){
  function tick(){
    updateClockAndTriggers();
    setTimeout(tick, 1000 - (Date.now()%1000) + 5);
  }
  tick();
})();

// ====== WAKE LOCK ======
async function requestWakeLock(){
  try{
    if('wakeLock' in navigator){
      const wl=await navigator.wakeLock.request('screen');
      wl.addEventListener('release',()=>setStatus('Wake Lock lepas'));
      setStatus('Wake Lock aktif');
    }
  }catch{}
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden){ requestWakeLock(); updateClockAndTriggers(); } });

// ====== BOOT ======
async function boot(){
  setStatus('Init…');
  await loadVideo();
  await fetchJadwalWithRetry();
  await primeAutoplay();
  await requestWakeLock();

  // Refresh 00:10 WIB (jadwal & video) — signage aman
  setInterval(async ()=>{
    const {hh,mm}=getWIBParts();
    if(hh==='00' && mm==='10'){
      await fetchJadwalWithRetry();
      await loadVideo();
      location.reload();
    }
  }, 30000);
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
