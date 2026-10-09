/* ============================================================
   JADWAL KAMPUS — app.js
   Jadwal kuliah gabungan teori + praktikum, deteksi bentrok,
   ekspor ICS/PNG/PDF. Data tersimpan di localStorage.
   ============================================================ */
'use strict';

/* ---------- tiny helpers ---------- */
const $ = id => document.getElementById(id);
const HARI = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'];

const STORAGE_KEY = 'jadwal-kampus';
const LEGACY_KEY = 'jadwalku';
let data = [];
try {
  let raw = localStorage.getItem(STORAGE_KEY);
  // BUG-6.2: one-time migration from legacy 'jadwalku' key, then remove it
  if (raw === null) {
    raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      localStorage.setItem(STORAGE_KEY, raw);
      localStorage.removeItem(LEGACY_KEY);
    }
  }
  data = JSON.parse(raw || '[]');
  if (!Array.isArray(data)) data = [];
} catch (e) { data = []; }

let editingId = null;

/* ---------- storage ---------- */
const save = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { toast('Penyimpanan penuh — hapus jadwal lama'); }
};

/* ---------- MASTER + KODE MK (auto mode) ---------- */
const MASTER_KEY = 'jadwal-master';
const PICKS_KEY = 'jadwal-kodepicks';
const MODE_KEY = 'jadwal-mode';
let master = [];
let kodePicks = []; // [{kode, kelas}]  — kelas='' berarti belum dipilih (multi)
const saveMaster = () => { try { localStorage.setItem(MASTER_KEY, JSON.stringify(master)); } catch (e) {} };
const savePicks = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(kodePicks)); } catch (e) {} };
try {
  let m = localStorage.getItem(MASTER_KEY); master = JSON.parse(m || '[]'); if (!Array.isArray(master)) master = [];
} catch (e) { master = []; }
try {
  let p = localStorage.getItem(PICKS_KEY); kodePicks = JSON.parse(p || '[]'); if (!Array.isArray(kodePicks)) kodePicks = [];
} catch (e) { kodePicks = []; }

/* ---------- IMPORT ANTI-DUPLIKAT (file tetap setelah proses, tahan reload) ----------
   Setiap file yang sukses diproses dicatat di processedFiles (Set), key = HASH ISI file.
   Hash isi (bukan name|size|lastModified) supaya file yang sama tapi di-rename atau
   di-download ulang (lastModified berubah) tetap terdeteksi duplikat. Persisten di
   localStorage agar tahan reload. Dibersihkan saat "Hapus semua". */
const PROC_KEY = 'jk-processed';
// Hash 64-bit (FNV-1a x2 + panjang) atas isi file. Dipakai untuk anti-duplikat:
// nama file bisa diubah / file di-download ulang (lastModified lain) tapi isinya sama.
/* ponytail: hash 64-bit cukup — bukan untuk keamanan, hanya penanda duplikat.
   Kalau nanti butuh tahan tabrakan, ganti ke SHA-256 via crypto.subtle. */
function hashBytes(u8){
  let h1=0x811c9dc5,h2=0x01000193;
  for(let i=0;i<u8.length;i++){
    const b=u8[i];
    h1^=b;h1=Math.imul(h1,0x01000193)>>>0;
    h2=(h2+b)>>>0;h2=Math.imul(h2,0x85ebca6b)>>>0;
  }
  return (h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0')+'-'+u8.length.toString(16);
}
// fileKey dipakai sebagai fallback bila hash belum tersedia (mis. file gagal dibaca).
const fileKey = f => `${f.name}|${f.size}|${f.lastModified}`;
let processedFiles = new Set((() => { try { return JSON.parse(localStorage.getItem(PROC_KEY)) || []; } catch (e) { return []; } })());
const saveProcessed = () => { try { localStorage.setItem(PROC_KEY, JSON.stringify([...processedFiles])); } catch (e) {} };

/* ---------- string / time utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toMin = s => { const str=String(s??'').trim(); if(str===''||str===':')return NaN; const p=str.split(':').map(Number); if(isNaN(p[0]))return NaN; return p[0]*60 + (isNaN(p[1])?0:p[1]); };
const sortMin = s => { const m=toMin(s); return isNaN(m)?Infinity:m; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmtTime = s => esc(String(s??'').slice(0,5));
/* normalisasi kode MK: uppercase + strip dash/spasi/titik/underscore
   supaya "IF301","if301","IF-301","IF 301" semua cocok.
   (kode disimpan as-is oleh importRows — hanya trim+collapse — jadi
   matching WAJIB pakai normalisasi ini.) */
const normKode = s => String(s??'').toUpperCase().replace(/[\s\-_.]/g,'');
/* parse textarea daftar kode: split baris/koma/titik-koma, trim, normalize, dedupe */
const parseKodeInput = text => {
  const seen = new Set();
  return String(text||'').split(/[\n,;]+/).map(s=>normKode(s)).filter(Boolean).filter(k => {
    if (seen.has(k)) return false; seen.add(k); return true;
  });
};

/* ---------- toast ---------- */
let toastTimer;
const toast = (m) => {
  const t = $('toast');
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
};

/* ---------- bentrok detection ---------- */
function bentrok(a, b) {
  if (a.hari !== b.hari) return false;
  const am=toMin(a.mulai),az=toMin(a.selesai),bm=toMin(b.mulai),bz=toMin(b.selesai);
  if(isNaN(am)||isNaN(az)||isNaN(bm)||isNaN(bz))return false;
  return am < bz && bm < az;
}
function tandaiBentrok(list) {
  const ids = new Set();
  const groups = []; // [[i,j], ...]
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (bentrok(list[i], list[j])) {
        ids.add(list[i].id); ids.add(list[j].id);
        groups.push([list[i], list[j]]);
      }
    }
  }
  return { ids, groups };
}

/* ---------- filters ---------- */
let curSort = 'hari'; // hari | mulai | matkul
let fHariVal = '';     // day chip value
let fHariLocked = false; // long-pressed day strip → filter stays across render
let fTipeVal = '';     // tipe chip value
function filtered() {
  const q = $('q').value.toLowerCase().trim();
  const h = fHariVal;
  const t = fTipeVal;
  const p = $('fProdi').value;
  const k = $('fKelas').value;
  return data.filter(d => {
    const hay = ((d.matkul||'')+' '+(d.dosen||'')+' '+(d.kode||'')+' '+(d.ruang||'')+' '+(d.prodi||'')+' '+(d.kelas||'')).toLowerCase();
    return (!q || hay.includes(q))
      && (!h || d.hari === h)
      && (!t || d.tipe === t)
      && (!p || d.prodi === p)
      && (!k || d.kelas === k);
  }).sort((a,b) => {
    if (curSort === 'matkul') return (a.matkul||'').localeCompare(b.matkul||'');
    if (curSort === 'mulai') return sortMin(a.mulai) - sortMin(b.mulai);
    return HARI.indexOf(a.hari) - HARI.indexOf(b.hari) || sortMin(a.mulai) - sortMin(b.mulai);
  });
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const list = filtered();
  const { ids: clash, groups } = tandaiBentrok(data);

  /* --- stats with animation --- */
  const todayKey = HARI[(new Date().getDay() + 6) % 7]; // getDay: 0=Minggu..6=Sabtu → map ke Senin..Minggu
  animateStat('stTotal', data.length);
  animateStat('stSKS', data.reduce((s,d) => s + (+d.sks || 0), 0));
  animateStat('stBentrok', clash.size);
  animateStat('stHariIni', data.filter(d => d.hari === todayKey).length);

  /* --- count pill --- */
  $('count').textContent = list.length;

  /* --- alert bentrok --- */
  const ab = $('alertBentrok');
  if (clash.size) {
    ab.classList.remove('hidden');
    const pairs = groups.map(([a,b]) => `<li><b>${esc(a.matkul)}</b> (${fmtTime(a.mulai)}–${fmtTime(a.selesai)}) ↔ <b>${esc(b.matkul)}</b> (${fmtTime(b.mulai)}–${fmtTime(b.selesai)}) • ${esc(a.hari)}</li>`).join('');
    ab.innerHTML = `<span class="alert-ico">⚠️</span><div class="alert-body"><b>${clash.size} kelas bentrok!</b> Baris merah bertabrakan jamnya di hari yang sama. Ubah jam / hapus salah satu.<details><summary>Lihat detail bentrok</summary><ul>${pairs}</ul></details></div>`;
  } else {
    ab.classList.add('hidden');
  }

  /* --- filter selects (prodi/kelas) --- */
  const prodis = [...new Set(data.map(d => d.prodi).filter(Boolean))];
  const kelas = [...new Set(data.map(d => d.kelas).filter(Boolean))];
  const fp = $('fProdi'), fk = $('fKelas');
  // BUG-1.3: only rebuild select innerHTML when the option SET actually changed,
  // so an open dropdown doesn't collapse on every render() tick.
  const pSig = '|' + prodis.join('|');
  const kSig = '|' + kelas.join('|');
  if (fp.dataset.sig !== pSig) {
    fp.dataset.sig = pSig;
    const vp = fp.value;
    fp.innerHTML = '<option value="">🎓 Semua Prodi</option>' + prodis.map(p => `<option>${esc(p)}</option>`).join('');
    fp.value = prodis.includes(vp) ? vp : '';
  }
  if (fk.dataset.sig !== kSig) {
    fk.dataset.sig = kSig;
    const vk = fk.value;
    fk.innerHTML = '<option value="">🏫 Semua Kelas</option>' + kelas.map(p => `<option>${esc(p)}</option>`).join('');
    fk.value = kelas.includes(vk) ? vk : '';
  }

  /* --- day chips --- */
  const chips = $('chipHari');
  if (!chips.dataset.built) {
    chips.dataset.built = '1';
    chips.innerHTML = '<button class="chip on" data-h="">Semua hari</button>' + HARI.map(h => `<button class="chip" data-h="${h}">${h.slice(0,3)}</button>`).join('');
    chips.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      chips.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      fHariVal = c.dataset.h || '';
      render();
    }));
  }
  // sync day chip highlight with current value
  if (chips) chips.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', (c.dataset.h || '') === fHariVal));

  /* --- day strip (quick per-day filter) --- */
  const ds = $('dayStrip');
  if (ds) {
    // build once; counts (badge) updated each render
    if (!ds.dataset.built) {
      ds.dataset.built = '1';
      const allBtn = `<button class="ds-btn on" data-h="" role="tab">Semua<span class="ds-n">${data.length}</span></button>`;
      ds.innerHTML = allBtn + HARI.map(h => `<button class="ds-btn" data-h="${h}" role="tab">${h.slice(0,3)}<span class="ds-n">0</span></button>`).join('');
      let pressTimer = null, didLongPress = false;
      ds.querySelectorAll('.ds-btn').forEach(b => b.addEventListener('click', () => {
        // klik setelah long-press → batal (long-press sudah mengunci). Tanpa ini
        // handler click berjalan setelah timer & menimpa fHariLocked=false.
        if (didLongPress) { didLongPress = false; return; }
        // tap = toggle filter 1 hari (atau reset ke Semua kalau sama)
        const h = b.dataset.h || '';
        const next = (fHariVal === h && !fHariLocked) ? '' : h;
        fHariVal = next;
        fHariLocked = false; // tap biasa = tidak kunci
        syncDayStrip(); render();
      }));
      // long-press = lock filter hari (tetap walau data berganti/render)
      ds.querySelectorAll('.ds-btn').forEach(b => {
        const start = () => {
          didLongPress = false;
          pressTimer = setTimeout(() => {
            pressTimer = null; didLongPress = true;
            fHariVal = b.dataset.h || '';
            fHariLocked = !!b.dataset.h; // "Semua" tidak perlu kunci
            syncDayStrip(); render();
            if (fHariLocked) toast('Filter ' + (b.dataset.h || 'Semua') + ' terkunci 🔒');
          }, 500);
        };
        const cancel = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
        b.addEventListener('pointerdown', start);
        b.addEventListener('pointerup', cancel);
        b.addEventListener('pointerleave', cancel);
        b.addEventListener('pointercancel', cancel);
      });
    }
    // update counts
    const counts = { '': data.length };
    HARI.forEach(h => counts[h] = data.filter(d => d.hari === h).length);
    ds.querySelectorAll('.ds-btn').forEach(b => {
      const n = b.querySelector('.ds-n');
      if (n) n.textContent = counts[b.dataset.h || ''] ?? 0;
    });
    syncDayStrip();
  }
  function syncDayStrip() {
    ds?.querySelectorAll('.ds-btn').forEach(b => {
      b.classList.toggle('on', (b.dataset.h || '') === fHariVal);
      b.classList.toggle('locked', fHariLocked && (b.dataset.h || '') === fHariVal);
    });
  }

  /* --- calendar (grid) --- */
  const cal = $('calendar');
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  cal.innerHTML = HARI.map(h => {
    const ev = list.filter(d => d.hari === h);
    const isToday = h === todayKey;
    return `<div class="daycol ${isToday?'today':''}"><h4>${esc(h.slice(0,3))} <small>${ev.length}</small></h4>` +
      ev.map(d => {
        const clashCls = clash.has(d.id) ? 'bentrok' : '';
        const prakCls = d.tipe === 'Praktikum' ? 'prak' : '';
        const dm=toMin(d.mulai),dz=toMin(d.selesai);
        const isNow = isToday && !isNaN(dm)&&!isNaN(dz) && dm <= nowMin && nowMin < dz ? 'ev-now' : '';
        return `<div class="ev ${prakCls} ${clashCls} ${isNow}" data-id="${d.id}" title="Klik untuk edit"><b>${fmtTime(d.mulai)} ${esc(d.matkul)}</b>${d.ruang?' • '+esc(d.ruang):''}${d.kelas?' • '+esc(d.kelas):''}</div>`;
      }).join('') + '</div>';
  }).join('');

  /* --- calendar list view --- */
  const calList = $('calList');
  calList.innerHTML = HARI.map(h => {
    const ev = list.filter(d => d.hari === h).sort((a,b) => sortMin(a.mulai)-sortMin(b.mulai));
    if (!ev.length) return '';
    return `<div class="cal-day-title">${esc(h)}</div>` +
      ev.map(d => `<div class="ev ${d.tipe==='Praktikum'?'prak':''} ${clash.has(d.id)?'bentrok':''}" data-id="${d.id}"><b>${fmtTime(d.mulai)}–${fmtTime(d.selesai)}</b> ${esc(d.matkul)}${d.ruang?' • '+esc(d.ruang):''}</div>`).join('');
  }).join('');

  /* --- table (desktop) --- */
  const tbody = $('tbody');
  tbody.innerHTML = list.length
    ? list.map(d => `<tr class="${clash.has(d.id)?'bentrok':''}" data-id="${d.id}">
        <td><b>${esc(d.hari)||'-'}</b></td>
        <td>${fmtTime(d.mulai)||'-'}${fmtTime(d.selesai)?'–'+fmtTime(d.selesai):''}</td>
        <td><b>${esc(d.matkul)}</b>${d.sks?` <span class="muted" style="font-weight:400">(${d.sks} sks)</span>`:''}</td>
        <td>${esc(d.kode)||'-'}</td>
        <td>${esc(d.dosen)||'-'}</td>
        <td>${esc(d.kelas)||'-'}</td>
        <td>${esc(d.ruang)||'-'}</td>
        <td><span class="badge ${d.tipe==='Praktikum'?'Praktikum':'Teori'}">${esc(d.tipe)||'-'}</span></td>
        <td><button class="del" data-del="${d.id}" title="Hapus">🗑️</button></td>
      </tr>`).join('')
    : `<tr><td colspan="9" class="empty-row">${data.length?'Tidak ada jadwal yang cocok dengan filter.':'Belum ada jadwal — tambah manual / upload Excel / muat data contoh.'}</td></tr>`;

  /* --- cards (mobile) --- */
  const cards = $('cards');
  cards.innerHTML = list.length
    ? list.map(d => `<div class="jcard ${d.tipe==='Praktikum'?'prak':''} ${clash.has(d.id)?'bentrok':''}" data-id="${d.id}">
        <div class="jt">${esc(d.matkul)}${d.sks?` <span class="muted" style="font-weight:400;font-size:12px">${d.sks} sks</span>`:''}</div>
        <div class="jm">📅 ${esc(d.hari)||'-'} • ⏰ ${fmtTime(d.mulai)||'-'}${fmtTime(d.selesai)?'–'+fmtTime(d.selesai):''}${d.ruang?' • 📍 '+esc(d.ruang):''}${d.kelas?' • 🏫 '+esc(d.kelas):''}${d.dosen?' • 👨‍🏫 '+esc(d.dosen):''}</div>
        <div class="jr"><span class="badge ${d.tipe==='Praktikum'?'Praktikum':'Teori'}">${d.tipe==='Praktikum'?'🧪 Praktikum':'📖 Teori'}</span><button class="del" data-del="${d.id}" title="Hapus">🗑️</button></div>
      </div>`).join('')
    : `<p class="muted" style="text-align:center;padding:20px">${data.length?'Tidak ada jadwal yang cocok dengan filter.':'Belum ada jadwal.'}</p>`;

  /* --- empty state --- */
  const empty = $('emptyState');
  if (!data.length) {
    empty.classList.remove('hidden');
    cards.innerHTML = '';
  } else {
    empty.classList.add('hidden');
  }
}

/* animated stat counter */
function animateStat(id, target) {
  const el = $(id);
  const cur = parseInt(el.textContent) || 0;
  if (cur === target) return;
  // BUG-1.2: cancel any in-flight animation on this element to avoid races
  if (el._raf) cancelAnimationFrame(el._raf);
  const step = target > cur ? 1 : -1;
  const diff = Math.abs(target - cur);
  const stride = Math.max(1, Math.floor(diff / 12));
  let v = cur;
  const tick = () => {
    v += step * stride;
    if ((step > 0 && v >= target) || (step < 0 && v <= target)) {
      el.textContent = target;
      // re-trigger the countUp animation so it plays every time the value lands
      el.style.animation = 'none';
      void el.offsetWidth; // force reflow
      el.style.animation = 'countUp .35s ease';
      el._raf = 0;
      return;
    }
    el.textContent = v;
    el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

/* ============================================================
   CRUD — add / edit / delete / duplicate
   ============================================================ */
$('formAdd').addEventListener('submit', e => {
  e.preventDefault();
  if (!$('inMatkul').value.trim()) return toast('Nama matkul wajib diisi');
  if (!$('inHari').value) return toast('Pilih hari dulu');
  const am=toMin($('inMulai').value),az=toMin($('inSelesai').value);
  if(isNaN(am)||isNaN(az))return toast('Jam mulai & selesai wajib diisi');
  if (am >= az) return toast('Jam selesai harus lebih besar dari jam mulai');
  data.push({
    id: uid(), matkul: $('inMatkul').value.trim(), kode: $('inKode').value.trim(), sks: Math.min(8, Math.max(0, +$('inSKS').value || 0)),
    hari: $('inHari').value, tipe: $('inTipe').value, mulai: $('inMulai').value, selesai: $('inSelesai').value,
    kelas: $('inKelas').value.trim(), ruang: $('inRuang').value.trim(), dosen: $('inDosen').value.trim(), prodi: $('inProdi').value.trim()
  });
  save(); render(); e.target.reset();
  $('inSKS').value = 2; $('inMulai').value = '08:00'; $('inSelesai').value = '09:40';
  toast('Jadwal ditambahkan ✓');
});

/* event delegation: click row/card -> edit; click del -> delete */
function handleListClick(e) {
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    e.stopPropagation();
    hapus(delBtn.dataset.del);
    return;
  }
  const item = e.target.closest('[data-id]');
  if (item) openEdit(item.dataset.id);
}
$('tbody').addEventListener('click', handleListClick);
$('cards').addEventListener('click', handleListClick);
$('calendar').addEventListener('click', handleListClick);
$('calList').addEventListener('click', handleListClick);

function hapus(id) {
  openConfirm('Hapus jadwal ini?', 'Data yang dihapus tidak bisa dikembalikan.', () => {
    data = data.filter(d => d.id !== id);
    save(); render(); toast('Dihapus ✓');
  });
}

/* ---------- EDIT MODAL ---------- */
function openEdit(id) {
  const d = data.find(x => x.id === id);
  if (!d) return;
  editingId = id;
  $('edMatkul').value = d.matkul || '';
  $('edKode').value = d.kode || '';
  $('edSKS').value = d.sks || 0;
  $('edHari').value = d.hari || '';
  $('edTipe').value = d.tipe || 'Teori';
  $('edMulai').value = d.mulai || '08:00';
  $('edSelesai').value = d.selesai || '09:40';
  $('edKelas').value = d.kelas || '';
  $('edRuang').value = d.ruang || '';
  $('edDosen').value = d.dosen || '';
  $('edProdi').value = d.prodi || '';
  openModal('modalEdit');
  setTimeout(() => $('edMatkul').focus(), 100);
}

$('formEdit').addEventListener('submit', e => {
  e.preventDefault();
  if (!editingId) return;
  if (!$('edMatkul').value.trim()) return toast('Nama matkul wajib diisi');
  if (!$('edHari').value) return toast('Pilih hari dulu');
  const em=toMin($('edMulai').value),ez=toMin($('edSelesai').value);
  if(isNaN(em)||isNaN(ez))return toast('Jam mulai & selesai wajib diisi');
  if (em >= ez) return toast('Jam selesai harus > jam mulai');
  const d = data.find(x => x.id === editingId);
  if (!d) { closeModal('modalEdit'); return; }
  Object.assign(d, {
    matkul: $('edMatkul').value.trim(), kode: $('edKode').value.trim(), sks: +$('edSKS').value || 0,
    hari: $('edHari').value, tipe: $('edTipe').value, mulai: $('edMulai').value, selesai: $('edSelesai').value,
    kelas: $('edKelas').value.trim(), ruang: $('edRuang').value.trim(), dosen: $('edDosen').value.trim(), prodi: $('edProdi').value.trim()
  });
  save(); render(); closeModal('modalEdit'); toast('Perubahan disimpan ✓');
});

$('edDuplikat').addEventListener('click', () => {
  if (!editingId) return;
  const d = data.find(x => x.id === editingId);
  if (!d) return;
  data.push({ ...d, id: uid() });
  save(); render(); closeModal('modalEdit'); toast('Jadwal diduplikat ✓');
});

$('edHapus').addEventListener('click', () => {
  if (!editingId) return;
  const id = editingId;
  closeModal('modalEdit');
  openConfirm('Hapus jadwal ini?', 'Data yang dihapus tidak bisa dikembalikan.', () => {
    data = data.filter(x => x.id !== id); save(); render(); toast('Dihapus ✓');
  });
});

/* ============================================================
   MODAL helpers
   ============================================================ */
// BUG-2.5/7.2: focus trap inside open modal
let _trapHandler = null;
function installFocusTrap(modal) {
  if (_trapHandler) document.removeEventListener('keydown', _trapHandler);
  _trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const f = modal.querySelectorAll('input,select,textarea,button,a[href],[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', _trapHandler);
  // focus first field shortly after open
  setTimeout(() => {
    const f = modal.querySelector('input,select,textarea');
    if (f) f.focus();
  }, 50);
}
function removeFocusTrap() {
  if (_trapHandler) { document.removeEventListener('keydown', _trapHandler); _trapHandler = null; }
}
function openModal(id) {
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  installFocusTrap($(id));
}
function closeModal(id) {
  $(id).classList.add('hidden');
  document.body.style.overflow = '';
  removeFocusTrap();
  if (id === 'modalEdit') editingId = null;
}
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', e => {
  const m = e.target.closest('.modal');
  if (m) closeModal(m.id);
}));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m.id));
    const sm = $('shareMenu'); if (!sm.hidden) sm.hidden = true;
  }
});

/* confirm modal */
let confirmCb = null;
function openConfirm(title, text, cb) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  confirmCb = cb;
  openModal('modalConfirm');
}
$('confirmOk').addEventListener('click', () => {
  closeModal('modalConfirm');
  if (confirmCb) { confirmCb(); confirmCb = null; }
});

/* ============================================================
   THEME
   ============================================================ */
const themeMeta = document.querySelector('meta[name="theme-color"]');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('btnTheme').textContent = t === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('jk-theme', t); } catch (_) {}
  if (themeMeta) themeMeta.setAttribute('content', t === 'dark' ? '#0a0a14' : '#4f46e5');
}
$('btnTheme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'dark' ? 'Mode gelap aktif 🌙' : 'Mode terang aktif ☀️');
});
try {
  const th = localStorage.getItem('jk-theme');
  if (th === 'dark' || th === 'light') applyTheme(th);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
} catch (_) {}

/* ============================================================
   SHARE MENU
   ============================================================ */
$('btnShare').addEventListener('click', e => {
  e.stopPropagation();
  const sm = $('shareMenu');
  const open = sm.hidden;
  sm.hidden = !open;
  sm.closest('.menu-wrap')?.classList.toggle('open', open);
});
document.addEventListener('click', e => {
  const sm = $('shareMenu');
  if (!sm.hidden && !e.target.closest('.menu-wrap')) {
    sm.hidden = true;
    sm.closest('.menu-wrap')?.classList.remove('open');
  }
});
$('shareMenu').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  $('shareMenu').hidden = true;
  $('shareMenu').closest('.menu-wrap')?.classList.remove('open');
}));

/* ============================================================
   SHARE / MERGE JADWAL via link
   - Jadwal personal (data[]) dienkode base64url di ?d= lalu ditempel ke teman.
   - Teman buka link → data otomatis dimuat (replace). Klik "Gabung" → tambahkan
     (assign id baru) supaya cek bentrok bareng kelompok.
   - Master & kodePicks TIDAK ikut — hanya jadwal personal yang relevan untuk
     cek bentrok kelompok (master bisa ribuan baris, terlalu besar untuk URL).
   ============================================================ */
function encodeJadwalLink() {
  try {
    const json = JSON.stringify(data);
    // base64url: btoa gagal untuk non-ASCII (matkul Bahasa Indonesia aman, tapi
    // jaga-jaga untuk karakter UTF-8). Encode UTF-8 → base64 → url-safe.
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const base = location.origin + location.pathname;
    return base + '?d=' + b64url;
  } catch (e) { return ''; }
}
function decodeJadwalLink(raw) {
  try {
    if (!raw) return null;
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
$('btnShareLink').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada jadwal untuk dibagikan');
  const link = encodeJadwalLink();
  if (!link) return toast('Gagal membuat link');
  $('shareLinkOut').value = link;
  $('shareLinkIn').value = '';
  $('mergeMsg').textContent = '';
  $('mergeMsg').className = 'merge-msg';
  openModal('modalMerge');
  setTimeout(() => $('shareLinkOut').select(), 100);
});
$('btnCopyLink').addEventListener('click', async () => {
  const link = $('shareLinkOut').value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link disalin 📋');
  } catch (e) {
    $('shareLinkOut').select();
    // execCommand('copy') is deprecated but still the only clipboard fallback for
    // non-secure (http) or older browsers; navigator.clipboard is preferred above.
    document.execCommand('copy');
    toast('Link disalin 📋');
  }
});
$('btnMergeLink').addEventListener('click', () => {
  const raw = $('shareLinkIn').value.trim();
  const msg = $('mergeMsg');
  msg.textContent = 'Memeriksa link...'; msg.className = 'merge-msg';
  // Ekstrak payload ?d= dari link yang ditempel (boleh full URL atau hanya payload)
  let payload = raw;
  try {
    const u = new URL(raw);
    payload = u.searchParams.get('d') || '';
  } catch (e) {
    // bukan URL valid — mungkin payload mentah; pakai apa adanya
    const m = raw.match(/[?&]d=([^&]+)/);
    if (m) payload = decodeURIComponent(m[1]);
  }
  const incoming = decodeJadwalLink(payload);
  if (!incoming || !incoming.length) {
    msg.textContent = '✗ Link tidak valid atau jadwal kosong.'; msg.className = 'merge-msg err';
    return;
  }
  // validasi field minimal — tolak struktur aneh
  const valid = incoming.filter(d => d && d.matkul && d.hari && d.mulai && d.selesai);
  if (!valid.length) {
    msg.textContent = '✗ Data dari link rusak (tidak ada baris valid).'; msg.className = 'merge-msg err';
    return;
  }
  // assign id baru supaya tidak tabrakan id yang sudah ada
  valid.forEach(d => { d.id = uid(); });
  data.push(...valid);
  save(); render(); closeModal('modalMerge');
  const added = valid.length;
  const clashes = tandaiBentrok(data).groups.length;
  toast('+' + added + ' kelas digabung' + (clashes ? ' • ' + clashes + ' bentrok baru ⚠️' : ' ✓'));
});
/* Auto-load dari ?d= saat buka link share. Replace (bukan merge) — ini halaman
   fresh. Tunda sedikit supaya render() awal tidak menimpa. */
(function loadFromShareLink() {
  try {
    const u = new URL(location.href);
    const d = u.searchParams.get('d');
    if (!d) return;
    const incoming = decodeJadwalLink(d);
    if (incoming && incoming.length) {
      incoming.forEach(x => { if (!x.id) x.id = uid(); });
      data = incoming; save();
      setTimeout(() => { render(); toast(incoming.length + ' kelas dimuat dari link 📥'); }, 150);
      // bersihkan ?d= dari URL supaya refresh tidak terus-terusan mengganti data
      history.replaceState({}, '', location.pathname);
    }
  } catch (e) {}
})();

/* ============================================================
   FILTERS
   ============================================================ */
/* debounce render() so fast typing in search/filter doesn't thrash the DOM */
let _renderRaf = 0;
const renderDebounced = () => {
  if (_renderRaf) cancelAnimationFrame(_renderRaf);
  _renderRaf = requestAnimationFrame(() => { _renderRaf = 0; render(); });
};
['q','fProdi','fKelas'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('input', renderDebounced);
  el.addEventListener('change', render);
});
// tipe chips (data-t)
document.querySelectorAll('.chip-row .chip[data-t]').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('.chip-row .chip[data-t]').forEach(x => x.classList.remove('on'));
  c.classList.add('on');
  fTipeVal = c.dataset.t || '';
  render();
}));
$('btnFilter').addEventListener('click', () => $('filterBody').classList.toggle('open'));
$('btnReset').addEventListener('click', () => {
  $('q').value = '';
  fHariVal = ''; fHariLocked = false; fTipeVal = '';
  $('fProdi').value = ''; $('fKelas').value = '';
  document.querySelectorAll('.chip[data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === ''));
  document.querySelectorAll('#chipHari .chip').forEach(x => x.classList.toggle('on', x.dataset.h === ''));
  render();
});
$('btnHapus').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada data untuk dihapus');
  openConfirm('Hapus SEMUA jadwal?', `Semua ${data.length} jadwal akan dihapus permanen.`, () => {
    data = []; save(); render(); toast('Semua jadwal dihapus ✓');
    // bersihkan daftar file terproses supaya user bisa re-import file yang sama
    // tanpa dianggap duplikat (mulai dari nol).
    processedFiles = new Set(); saveProcessed();
  });
});
$('btnSort').addEventListener('click', () => {
  const order = ['hari','mulai','matkul'];
  curSort = order[(order.indexOf(curSort) + 1) % order.length];
  const label = { hari:'Hari', mulai:'Jam mulai', matkul:'Nama matkul' }[curSort];
  render(); toast(`Urut: ${label}`);
});

/* ============================================================
   CALENDAR VIEW TOGGLE (grid / list)
   ============================================================ */
document.querySelectorAll('.seg-btn[data-view]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.seg-btn[data-view]').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  const grid = b.dataset.view === 'grid';
  $('calendar').classList.toggle('hidden', !grid);
  $('calList').classList.toggle('hidden', grid);
}));

/* ============================================================
   SWIPE on calendar / list — navigasi filter hari (mobile-friendly)
   Swipe kiri → hari berikutnya; kanan → sebelumnya. Lebih cepat daripada
   buka filter panel. Hanya aktif di mobile (lebar ≤900) supaya tidak
   mengganggu scroll horizontal grid di desktop.
   ============================================================ */
(function armSwipe() {
  let sx = 0, sy = 0, armed = false;
  const start = e => {
    if (window.innerWidth > 900) return;
    const t = e.touches ? e.touches[0] : e;
    sx = t.clientX; sy = t.clientY; armed = true;
  };
  const move = e => {
    if (!armed) return;
    const t = e.touches ? e.touches[0] : e;
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      armed = false;
      const cur = HARI.indexOf(fHariVal);
      let next;
      if (cur === -1) next = dx < 0 ? 0 : HARI.length - 1; // dari "Semua": kiri→Senin, kanan→Sabtu
      else next = (cur + (dx < 0 ? 1 : -1) + HARI.length) % HARI.length;
      fHariVal = HARI[next];
      fHariLocked = false;
      render();
      // scroll hari tsb ke tampil (di strip)
      const btn = $('dayStrip')?.querySelector(`.ds-btn[data-h="${fHariVal}"]`);
      btn?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  };
  const end = () => { armed = false; };
  const zones = [$('calendar'), $('calList')];
  zones.forEach(z => {
    if (!z) return;
    z.addEventListener('touchstart', start, { passive: true });
    z.addEventListener('touchmove', move, { passive: true });
    z.addEventListener('touchend', end, { passive: true });
  });
})();

/* ============================================================
   MOBILE TABS / NAV
   ============================================================ */
function goTab(t, silent) {
  // "top" (Beranda) = tampilkan view jadwal lalu scroll ke atas
  const view = t === 'top' ? 'jadwal' : t;
  document.body.dataset.mtab = view;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === view));
  document.querySelectorAll('.bottomnav button').forEach(b => b.classList.toggle('on', b.dataset.go === t));
  if (silent) return;
  if (t === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
  else if (t === 'jadwal') $('cardTabel').scrollIntoView({ behavior: 'smooth' });
  else if (t === 'tambah') {
    document.querySelector('.side .form-card')?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => $('inMatkul')?.focus(), 400);
  } else if (t === 'import') document.querySelector('.side .import-card')?.scrollIntoView({ behavior: 'smooth' });
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => goTab(b.dataset.tab)));
document.querySelectorAll('.bottomnav button').forEach(b => b.addEventListener('click', () => goTab(b.dataset.go)));
$('fab').addEventListener('click', () => goTab('tambah'));
// BUG-1.1: init — set tab state + highlight bottom-nav without scrolling on load
goTab('jadwal', true);

/* panduan: default terbuka di desktop, tertutup di mobile (hemat ruang) */
(function(){
  const g = $('panduan');
  if (g && window.innerWidth <= 900) g.removeAttribute('open');
})();

/* ============================================================
   AUTO KODE MK — regen jadwal personal dari master + kode pilihan
   ============================================================ */
/* index master by normalized kode → array of master rows (lintas kelas) */
function buildMasterIndex() {
  const idx = {};
  for (const d of master) {
    const k = normKode(d.kode);
    if (!k) continue;
    (idx[k] = idx[k] || []).push(d);
  }
  return idx;
}
/* kelas yang benar-benar dipakai tiap kode di data[] — dipakai renderKodeResult
   supaya chip ✓ ikut menampilkan kelas hasil auto-ambil (kode 1-kelas / fallback),
   bukan cuma yang dipilih manual. */
const effectiveKelas = new Map(); // normKode → kelas
/* regenerasi data[] dari master[] + kodePicks[].
   - kode yang cocok 1 kelas & pick.kelas kosong → auto-ambil
   - kode multi-kelas & pick.kelas kosong → TIDAK masuk (tunggu user pilih)
   - kode multi-kelas & pick.kelas dipilih → ambil kelas itu saja
   - kode tidak ada di master → skip (diangkat peringatan di renderKodeResult) */
function regenFromMaster() {
  if (!master.length) return;
  const idx = buildMasterIndex();
  const out = [];
  effectiveKelas.clear();
  for (const pick of kodePicks) {
    const rows = idx[pick.kode] || [];
    if (!rows.length) continue;
    if (pick.kelas) {
      const m = rows.filter(r => normKode(r.kelas) === normKode(pick.kelas));
      if (m.length) { out.push(...m.map(cloneRow)); effectiveKelas.set(pick.kode, m[0].kelas || pick.kelas); }
      else { out.push(...rows.map(cloneRow)); effectiveKelas.set(pick.kode, rows[0].kelas || ''); } // fallback: kelas hilang → ambil semua
    } else if (rows.length === 1) {
      out.push(cloneRow(rows[0])); // unambiguous → auto-ambil
      effectiveKelas.set(pick.kode, rows[0].kelas || '');
    }
    // rows.length>1 & no kelas picked → skip (tunggu pilihan)
  }
  data = out; save();
  renderKodeResult(); // effectiveKelas baru terisi lengkap → refresh chip + precheck
  render();
}
function cloneRow(d) {
  const c = Object.assign({}, d); c.id = uid(); return c;
}
/* render #kodeResult: tampilkan status tiap kode (✓ hijau / ✗ merah / pilih-kelas)
   + peringatan dini bentrok antar kode yang dipilih, sebelum masuk ke jadwal. */
function renderKodeResult() {
  const box = $('kodeResult');
  if (!box) return;
  if (!kodePicks.length) { box.innerHTML = ''; return; }
  const idx = buildMasterIndex();
  const rowsHtml = kodePicks.map((pick, i) => {
    const rows = idx[pick.kode] || [];
    if (!rows.length) {
      return `<div class="kode-entry err"><span class="kode-chip bad">✗ ${esc(pick.kode)}</span><small>tidak ditemukan di master</small></div>`;
    }
    if (rows.length === 1) {
      const r = rows[0];
      return `<div class="kode-entry ok"><span class="kode-chip good">✓ ${esc(r.kode||pick.kode)}</span><b>${esc(r.matkul)}</b><small>${esc(r.kelas||'-')} • ${esc(r.hari||'-')} • ${fmtTime(r.mulai)}–${fmtTime(r.selesai)}</small></div>`;
    }
    // multi-kelas → dropdown; kelas yang sudah efektif ditandai supaya user tahu
    // baris mana yang sedang dipakai jadwal saat pick.kelas masih kosong (fallback).
    const eff = effectiveKelas.get(pick.kode);
    const opts = rows.map(r => `<option value="${esc(r.kelas||'')}" ${selectMark(r, pick, eff)}>${esc(r.kelas||'-')} • ${esc(r.dosen||'-')} • ${fmtTime(r.mulai)}</option>`).join('');
    return `<div class="kode-entry pick"><span class="kode-chip multi">${esc(pick.kode)} ×${rows.length}</span><select class="kode-sel" data-ki="${i}"><option value="">— pilih kelas —</option>${opts}</select></div>`;
  }).join('');
  box.innerHTML = rowsHtml + precheckBentrok() + suggestKelas();
}
function selectMark(r, pick, eff) {
  if (pick.kelas) return normKode(r.kelas) === normKode(pick.kelas) ? 'selected' : '';
  return eff && normKode(r.kelas) === normKode(eff) ? 'selected' : '';
}
/* kelas alternatif per kode multi-kelas — supaya saran "pindah kelas" di bawah
   bisa menyebut U+201c kelas mana yang jamnya tidak bentrok U+201d. */
function kelasOpsi(kode) {
  const rows = (buildMasterIndex()[kode] || []).filter(r => r.hari && r.mulai && r.selesai);
  return rows.map(r => ({ kelas: r.kelas || '', hari: r.hari, mulai: r.mulai, selesai: r.selesai, matkul: r.matkul || '', dosen: r.dosen || '' }));
}
/* deteksi bentrok yang AKAN terjadi begitu kode masuk ke jadwal. Ini beda dari
   alert merah di halaman (yang membaca data[] setelah terlanjur masuk) —
   di sini user masih bisa ganti kelas / buang kode sebelum menyerah. */
function precheckBentrok() {
  const groups = tandaiBentrok(data).groups;
  if (!groups.length) return '';
  const list = groups.map(([a, b]) => `<li><b>${esc(a.matkul)}</b> (${esc(a.kelas)||'-'}) ${fmtTime(a.mulai)}–${fmtTime(a.selesai)} ↔ <b>${esc(b.matkul)}</b> (${esc(b.kelas)||'-'}) ${fmtTime(b.mulai)}–${fmtTime(b.selesai)} • ${esc(a.hari)}</li>`).join('');
  return `<div class="precheck"><b>⚠️ ${groups.length} bentrok di jadwal hasil pilihan ini</b><ul>${list}</ul></div>`;
}
/* untuk kode multi-kelas yang ikut bentrok: cari kelas lain yang jamnya bebas */
function suggestKelas() {
  const groups = tandaiBentrok(data).groups;
  if (!groups.length) return '';
  const guilty = new Set();
  groups.forEach(([a, b]) => { if (a.kode) guilty.add(normKode(a.kode)); if (b.kode) guilty.add(normKode(b.kode)); });
  const saran = [];
  for (const pick of kodePicks) {
    if (!guilty.has(pick.kode)) continue;
    const opsi = kelasOpsi(pick.kode);
    if (opsi.length < 2) continue; // hanya kode multi-kelas yang punya alternatif
    const bebas = opsi.filter(o =>
      !o.kelas || normKode(o.kelas) !== normKode(effectiveKelas.get(pick.kode)) // bukan kelas yang sekarang
    ).filter(o => !data.some(d => d.kode !== pick.kode && bentrok(d, o)));
    if (!bebas.length) continue;
    const label = bebas.slice(0, 3).map(o => `<b>${esc(o.matkul || o.kelas || '-')}</b> ${esc(o.kelas)||'-'} (${esc(o.hari)} ${fmtTime(o.mulai)}–${fmtTime(o.selesai)})`).join('<br>');
    saran.push(`<li><span class="saran-kode">${esc(pick.kode)}</span><div><small>coba kelas lain yang jamnya kosong:</small>${label}</div></li>`);
  }
  if (!saran.length) return '';
  return `<div class="suggest"><b>💡 Saran: ganti kelas</b><ul>${saran.join('')}</ul></div>`;
}
/* ============================================================
   TEMPLATES & CSV EXPORT
   ============================================================ */
const HEADER = 'matkul,kode,sks,hari,tipe,mulai,selesai,kelas,ruang,dosen,prodi';
const unduhCSV = (nama, isi) => {
  const a = document.createElement('a');
  // BUG-4.7: prepend UTF-8 BOM so Excel opens Indonesian accents correctly
  a.href = URL.createObjectURL(new Blob(['﻿' + isi], { type: 'text/csv;charset=utf-8' }));
  a.download = nama; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('btnTplTeori').addEventListener('click', () => unduhCSV('template-teori.csv',
  HEADER + '\nPemrograman Web,IF301,3,Senin,Teori,08:00,10:30,TI-3A,R-301,Budi Santoso,Teknologi Informasi\nBasis Data,IF302,3,Senin,Teori,10:30,13:00,TI-3A,R-302,Siti Aminah,Teknologi Informasi\nAlgoritma & Struktur Data,IF303,3,Rabu,Teori,08:00,10:30,TI-3A,R-303,Andi Wijaya,Teknologi Informasi\nKecerdasan Buatan,IF304,3,Kamis,Teori,13:00,15:30,TI-3A,R-304,Dewi Lestari,Teknologi Informasi'));
$('btnTplPraktikum').addEventListener('click', () => unduhCSV('template-praktikum.csv',
  HEADER + '\nPraktikum Pemrograman Web,IF301P,1,Selasa,Praktikum,08:00,10:30,TI-3A,Lab-2,Andi Wijaya,Teknologi Informasi\nPraktikum Basis Data,IF302P,1,Kamis,Praktikum,13:00,15:30,TI-3A,Lab-1,Siti Aminah,Teknologi Informasi\nPraktikum Algoritma,IF303P,1,Jumat,Praktikum,08:00,10:30,TI-3A,Lab-3,Budi Santoso,Teknologi Informasi'));

$('btnCSV').addEventListener('click', () => {
  const scope = filtered();
  if (!scope.length) return toast('Belum ada data (sesuai filter)');
  const r = scope.map(d => [d.matkul,d.kode,d.sks,d.hari,d.tipe,d.mulai,d.selesai,d.kelas,d.ruang,d.dosen,d.prodi].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  unduhCSV('jadwal-kampus.csv', [HEADER, ...r].join('\n'));
  toast('CSV diunduh ✓');
});

/* sample data */
function muatContoh() {
  const contoh = [
    {id:uid(),matkul:'Pemrograman Web',kode:'IF301',sks:3,hari:'Senin',tipe:'Teori',mulai:'08:00',selesai:'10:30',kelas:'TI-3A',ruang:'R-301',dosen:'Budi Santoso',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Basis Data',kode:'IF302',sks:3,hari:'Senin',tipe:'Teori',mulai:'08:00',selesai:'10:30',kelas:'TI-3A',ruang:'R-302',dosen:'Siti Aminah',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Algoritma & Struktur Data',kode:'IF303',sks:3,hari:'Rabu',tipe:'Teori',mulai:'08:00',selesai:'10:30',kelas:'TI-3A',ruang:'R-303',dosen:'Andi Wijaya',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Praktikum Pemrograman Web',kode:'IF301P',sks:1,hari:'Selasa',tipe:'Praktikum',mulai:'08:00',selesai:'10:30',kelas:'TI-3A',ruang:'Lab-2',dosen:'Andi Wijaya',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Praktikum Basis Data',kode:'IF302P',sks:1,hari:'Kamis',tipe:'Praktikum',mulai:'13:00',selesai:'15:30',kelas:'TI-3A',ruang:'Lab-1',dosen:'Siti Aminah',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Kecerdasan Buatan',kode:'IF304',sks:3,hari:'Kamis',tipe:'Teori',mulai:'13:00',selesai:'15:30',kelas:'TI-3A',ruang:'R-304',dosen:'Dewi Lestari',prodi:'Teknologi Informasi'},
    {id:uid(),matkul:'Jaringan Komputer',kode:'IF305',sks:3,hari:'Jumat',tipe:'Teori',mulai:'08:00',selesai:'10:30',kelas:'TI-3A',ruang:'R-305',dosen:'Rudi Hartono',prodi:'Teknologi Informasi'}
  ];
  data = contoh; save(); render(); toast('Data contoh dimuat ✓');
}
$('btnContoh').addEventListener('click', () => {
  if (data.length) openConfirm('Ganti dengan data contoh?', `Jadwal saat ini (${data.length}) akan diganti.`, muatContoh);
  else muatContoh();
});
$('btnEmptyContoh').addEventListener('click', muatContoh);

/* ============================================================
   AUTO KODE MK — wiring tombol & mode toggle
   ============================================================ */
/* mode toggle: Manual vs Auto Kode MK — pilihan disimpan supaya reload tidak
   diam-diam balik ke Manual padahal master + daftar kode masih tersimpan */
function setMode(mode, { silent = false } = {}) {
  mode = mode === 'auto' ? 'auto' : 'manual';
  document.querySelectorAll('.seg-btn[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
  document.body.dataset.mode = mode;
  try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
  if (mode === 'auto') {
    renderKodeResult();
    // master/picks masih ada tapi jadwal personal belum ter-regen (mis. setelah
    // reload) → susun ulang, kalau tidak sidebar bilang auto padahal tabel kosong
    if (master.length && kodePicks.length && !data.length) regenFromMaster();
    if (!silent && !master.length) toast('Import file master dulu (jadwal lengkap kampus)');
  }
}
document.querySelectorAll('.seg-btn[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
let savedMode = 'manual';
try { savedMode = localStorage.getItem(MODE_KEY) === 'auto' ? 'auto' : 'manual'; } catch (e) {}
setMode(savedMode, { silent: true });

/* pulihkan tampilan sidebar auto setelah reload: master & daftar kode tersimpan di
   localStorage, tapi isi textarea dan nama file tidak — tanpa ini sidebar bilang
   "Belum ada file" & kolom kode kosong padahal keduanya masih terpakai. */
(function restoreAutoUI() {
  if (master.length) {
    $('fileNameMaster').textContent = master.length + ' baris master tersimpan';
    $('previewMaster').textContent = '✓ ' + master.length + ' baris master tersimpan.';
  }
  if (kodePicks.length) $('kodeInput').value = kodePicks.map(p => p.kode).join('\n');
})();

/* import master: reuse importExcel dengan intoMaster=true */
$('btnMaster').addEventListener('click', () => importExcel('fileMaster','previewMaster','dropMaster','Teori','master',true));

/* Simpan/ganti seluruh master dari array baris yang sudah siap (dipakai oleh
   import file maupun tempelan portal). Mengganti — bukan menambah — supaya
   upload ulang tidak menggandakan baris (perilaku lama importExcel master). */
function ingestMasterRows(rows, sumber) {
  master = [];
  const r = importRows(rows, 'Teori', master);
  saveMaster();
  if (r.n) {
    $('previewMaster').textContent = '✓ ' + r.n + ' baris master tersimpan dari ' + sumber + '.' + (r.lewat ? ' (' + r.lewat + ' dilewati)' : '');
    toast(r.n + ' baris master tersimpan ✓');
    if (kodePicks.length) regenFromMaster(); else renderKodeResult();
  } else {
    $('previewMaster').textContent = '✗ Tidak ada baris valid dari ' + sumber + ' — pastikan yang tersalin berisi tabel jadwal (hari/jam/matkul).';
    toast('Tidak ada baris valid — cek hasil salinannya');
  }
  return r;
}

/* --- tempel tabel dari portal kampus (tanpa file) ---
   Portal SIA/SISKA/Labkom umumnya halaman HTML biasa; blok + Ctrl+C menghasilkan
   TSV (tab) atau CSV. Beberapa portal menyisipkan baris judul/section di atas
   tabel — importRows sudah menangani itu via detectHeader(). */
$('btnPasteMaster').addEventListener('click', () => {
  const raw = $('pasteInput').value;
  if (!String(raw).trim()) return toast('Tempel dulu tabel jadwalnya (Ctrl+V)');
  let rows;
  try { rows = parseCSVText(raw); } catch (e) { return toast('Gagal membaca tempelan'); }
  if (!rows || !rows.length) return toast('Tempelan kosong / tidak terbaca');
  // Ambil nama portal dari baris pertama kalau kelihatan seperti judul (1 sel panjang)
  const first = (rows[0] || []).filter(c => String(c || '').trim() !== '');
  const sumber = first.length === 1 && first[0].length > 3 ? '"' + String(first[0]).slice(0, 40) + '"' : 'tempelan portal';
  const r = ingestMasterRows(rows, sumber);
  if (r.n) $('pasteInput').value = ''; // bersihkan hanya kalau berhasil
});

/* --- simpan master ke CSV (backup / pindah perangkat) ---
   Tanpa ini master (bisa ribuan baris) hilang total kalau localStorage dibersihkan
   dan user harus mengunduh ulang dari portal. */
$('btnExportMaster').addEventListener('click', () => {
  if (!master.length) return toast('Belum ada master untuk disimpan');
  const r = master.map(d => [d.matkul,d.kode,d.sks,d.hari,d.tipe,d.mulai,d.selesai,d.kelas,d.ruang,d.dosen,d.prodi]
    .map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
  unduhCSV('master-jadwal.csv', [HEADER, ...r].join('\n'));
  toast('Master disimpan (' + master.length + ' baris) ✓');
});

/* parse kode dari textarea → set kodePicks → render result → regen */
$('btnParseKode').addEventListener('click', () => {
  if (!master.length) return toast('Import file master dulu (jadwal lengkap kampus)');
  const kodes = parseKodeInput($('kodeInput').value);
  if (!kodes.length) return toast('Masukkan minimal 1 kode MK');
  // preserve kelas picks yang sudah dipilih untuk kode yang sama
  const prev = {}; kodePicks.forEach(p => prev[p.kode] = p.kelas);
  kodePicks = kodes.map(k => ({ kode: k, kelas: prev[k] || '' }));
  savePicks();
  renderKodeResult();
  regenFromMaster();
  toast(kodes.length + ' kode di-parse ✓');
});
/* event delegation: pilih kelas via dropdown di #kodeResult */
$('kodeResult').addEventListener('change', e => {
  const sel = e.target.closest('.kode-sel');
  if (!sel) return;
  const i = +sel.dataset.ki;
  if (kodePicks[i]) { kodePicks[i].kelas = sel.value; savePicks(); regenFromMaster(); }
});
/* hapus master */
$('btnClearMaster').addEventListener('click', () => {
  if (!master.length && !kodePicks.length) return toast('Master sudah kosong');
  openConfirm('Hapus master & kode?', `File master (${master.length} baris) dan daftar kode akan dihapus. Jadwal personal TIDAK dihapus.`, () => {
    master = []; kodePicks = []; saveMaster(); savePicks();
    $('kodeInput').value = ''; $('previewMaster').textContent = ''; $('fileNameMaster').textContent = 'Belum ada file';
    paintDrop('dropMaster', null);
    renderKodeResult();
    toast('Master & kode dihapus ✓');
  });
});

/* ============================================================
   ICS & PNG EXPORT
   ============================================================ */
$('btnExportICS').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada data');
  const dayIdx = {Senin:1,Selasa:2,Rabu:3,Kamis:4,Jumat:5,Sabtu:6,Minggu:0};
  // Lock events to Asia/Jakarta (WIB, UTC+7) so 08:00 stays 08:00 regardless of
  // the importer's device timezone. We declare a full VTIMEZONE block (required by
  // strict parsers like Outlook) and reference it via TZID on each VEVENT.
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Jadwal-Kampus//ID\nCALSCALE:GREGORIAN\n';
  ics += 'BEGIN:VTIMEZONE\nTZID:Asia/Jakarta\nBEGIN:STANDARD\nDTSTART:19700101T000000\nTZOFFSETFROM:+0700\nTZOFFSETTO:+0700\nEND:STANDARD\nEND:VTIMEZONE\n';
  const p2 = n => String(n).padStart(2,'0');
  const escICS = t => String(t||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/[,;]/g,m=>'\\'+m);
  const stamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  filtered().forEach(d => {
    const dt = new Date();
    const target = dayIdx[d.hari]; if (target == null) return;
    const diff = (target - dt.getDay() + 7) % 7;
    dt.setDate(dt.getDate() + diff);
    const d8 = dt.getFullYear() + p2(dt.getMonth()+1) + p2(dt.getDate());
    const jam = x => { const [a,b] = String(x||'').split(':'); return p2(+a||0)+p2(+(b||0))+'00'; };
    ics += `BEGIN:VEVENT\nUID:${d.id}@jadwal-kampus\nDTSTAMP:${stamp}\nDTSTART;TZID=Asia/Jakarta:${d8}T${jam(d.mulai)}\nDTEND;TZID=Asia/Jakarta:${d8}T${jam(d.selesai)}\nSUMMARY:${escICS(d.matkul)}${d.kelas?' ('+escICS(d.kelas)+')':''}\nLOCATION:${escICS(d.ruang)}\nDESCRIPTION:${escICS(d.dosen)} ${escICS(d.kode)}\nRRULE:FREQ=WEEKLY;COUNT=16\nEND:VEVENT\n`;
  });
  ics += 'END:VCALENDAR';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type:'text/calendar' }));
  a.download = 'jadwal-kampus.ics'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('ICS diunduh — import ke Google Calendar 📆');
});

/* ============================================================
   EXPORT KE GOOGLE CALENDAR (langsung, tanpa file ICS)
   - Pakai endpoint https://www.google.com/calendar/render?action=TEMPLATE
     dengan parameters: text (judul), dates (start-end UTC), details, location,
     recurrence (RRULE). Google render event preview → user tinggal Save.
   - Karena 1 link = 1 event, kita buka jendela per kelas (atau 1 prompt pilih).
   - "Semua" → buka tab per kelas berurutan (browser mungkin blok popup banyak;
     mencegah: buka 1 per 1 lewat loop dengan jeda, atau tawarkan modal pilih).
   ============================================================ */
$('btnExportGCal').addEventListener('click', () => {
  const list = filtered();
  if (!list.length) return toast('Belum ada data (sesuai filter)');
  if (list.length === 1) { openGCalEvent(list[0]); return; }
  // banyak kelas → tawarkan: semua sekaligus (popup) atau satu per satu lewat toast
  openConfirm(
    'Tambah ke Google Calendar?',
    `${list.length} kelas akan dibuka sebagai event di Google Calendar. Browser mungkin memblokir popup banyak — izinkan popup untuk situs ini kalau tidak muncul semua.`,
    () => {
      let opened = 0;
      list.forEach((d, i) => setTimeout(() => { openGCalEvent(d, true); opened++; }, i * 350));
      toast(`${list.length} event dikirim ke Google Calendar 📅`);
    }
  );
});
function openGCalEvent(d, silent) {
  // hitung tanggal "hari ini atau minggu ini" untuk hari tsb, sama logika dgn ICS
  const dayIdx = { Senin:1, Selasa:2, Rabu:3, Kamis:4, Jumat:5, Sabtu:6, Minggu:0 };
  const target = dayIdx[d.hari]; if (target == null) { if (!silent) toast('Hari tidak valid'); return; }
  const dt = new Date();
  const diff = (target - dt.getDay() + 7) % 7;
  dt.setDate(dt.getDate() + diff);
  // Jakarta = UTC+7. WIB 08:00 → 01:00Z. Bangun UTC timestamps.
  const toUTC = (date, hhmm) => {
    const [h, m] = String(hhmm || '08:00').split(':').map(Number);
    const u = new Date(date);
    u.setUTCHours((h - 7 + 24) % 24, m || 0, 0, 0);
    return u;
  };
  const sDt = toUTC(dt, d.mulai);
  const eDt = toUTC(dt, d.selesai);
  // bedakan tanggal end kalau lintas tengah malam (jarang, tapi aman)
  if (toMin(d.selesai) <= toMin(d.mulai)) eDt.setDate(eDt.getDate() + 1);
  const fmt = u => u.getUTCFullYear() + String(u.getUTCMonth()+1).padStart(2,'0') + String(u.getUTCDate()).padStart(2,'0') + 'T' + String(u.getUTCHours()).padStart(2,'0') + String(u.getUTCMinutes()).padStart(2,'0') + '00Z';
  const text = encodeURIComponent((d.matkul || 'Kelas') + (d.kelas ? ' (' + d.kelas + ')' : ''));
  const dates = fmt(sDt) + '/' + fmt(eDt);
  const details = encodeURIComponent((d.dosen || '') + (d.kode ? ' • ' + d.kode : '') + ' • ' + (d.sks||0) + ' SKS • via Jadwal Kampus');
  const location = encodeURIComponent([d.ruang, d.kelas].filter(Boolean).join(' • '));
  const recur = encodeURIComponent('RRULE:FREQ=WEEKLY;COUNT=16');
  const url = `https://www.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}&recur=${recur}`;
  window.open(url, '_blank', 'noopener');
}

$('btnExportPNG').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada data');
  if (typeof html2canvas === 'undefined') return toast('Pustaka gambar belum termuat — cek internet');
  toast('Membuat gambar jadwal... ⏳');

  // Bangun POSTER jadwal lengkap (bukan screenshot tabel) — satu elemen
  // .png-poster berisi: header (judul + meta), grid kalender mingguan,
  // legenda, footer. Poster di-position absolute off-screen + visible,
  // ukuran menyesuaikan konten (scrollWidth/Height), lalu di-capture utuh.
  const list = filtered();
  const clash = tandaiBentrok(data);
  const _t = data.filter(d => d.tipe === 'Teori').length;
  const _p = data.filter(d => d.tipe === 'Praktikum').length;
  const _b = clash.ids.size;
  const _dateStr = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const sksTotal = data.reduce((s, d) => s + (+d.sks || 0), 0);

  // header per hari: "Senin (3)" — daftar event di kolomnya, urut jam
  const dayCols = HARI.filter(h => data.some(d => d.hari === h));
  // gunakan hari yang punya kelas; kalau kosong (semua hari tampil) fallback 7
  const hariPakai = dayCols.length ? dayCols : HARI;

  const fmtShort = s => fmtTime(s); // "08:00"
  const evCard = (d, isClash) => {
    const cls = ['png-ev'];
    if (d.tipe === 'Praktikum') cls.push('prak');
    if (isClash) cls.push('bentrok');
    const jam = fmtShort(d.mulai) + (fmtShort(d.selesai) ? '–' + fmtShort(d.selesai) : '');
    const meta = [d.kelas, d.ruang].filter(Boolean).join(' • ');
    return `<div class="${cls.join(' ')}">
      <div class="png-ev-jam">${esc(jam)}</div>
      <div class="png-ev-nama">${esc(d.matkul)}</div>
      ${d.kode ? `<div class="png-ev-kode">${esc(d.kode)}${d.sks ? ' · ' + d.sks + ' SKS' : ''}</div>` : ''}
      ${meta ? `<div class="png-ev-meta">${esc(meta)}</div>` : ''}
      ${d.dosen ? `<div class="png-ev-dosen">${esc(d.dosen)}</div>` : ''}
    </div>`;
  };

  // kolom per hari
  const colsHtml = hariPakai.map(h => {
    const evs = list.filter(d => d.hari === h)
      .sort((a, b) => sortMin(a.mulai) - sortMin(b.mulai));
    const n = evs.length;
    const todayCls = h === HARI[(new Date().getDay() + 6) % 7] ? ' today' : '';
    return `<div class="png-col${todayCls}">
      <div class="png-col-head"><span class="png-col-hari">${esc(h)}</span><span class="png-col-n">${n}</span></div>
      <div class="png-col-body">${evs.length
        ? evs.map(d => evCard(d, clash.ids.has(d.id))).join('')
        : '<div class="png-col-kosong">—</div>'}
      </div>
    </div>`;
  }).join('');

  const poster = document.createElement('div');
  poster.className = 'png-poster';
  poster.innerHTML = `
    <div class="png-poster-inner">
      <header class="png-head">
        <div class="png-head-brand">
          <span class="png-logo">📅</span>
          <div>
            <div class="png-title">Jadwal Kampus</div>
            <div class="png-sub">Jadwal Kuliah Mingguan</div>
          </div>
        </div>
        <div class="png-head-stats">
          <div class="png-stat"><b>${data.length}</b><small>Kelas</small></div>
          <div class="png-stat"><b>${sksTotal}</b><small>SKS</small></div>
          ${_b ? `<div class="png-stat bentrok"><b>${_b}</b><small>Bentrok</small></div>` : ''}
        </div>
      </header>
      <div class="png-grid" style="--cols:${hariPakai.length}">${colsHtml}</div>
      <div class="png-legend">
        <span class="png-leg png-leg-teo"></span><span>Teori (${_t})</span>
        <span class="png-leg png-leg-prak"></span><span>Praktikum (${_p})</span>
        ${_b ? `<span class="png-leg png-leg-clash"></span><span>Bentrok (${_b})</span>` : ''}
        <span class="png-leg-date">${esc(_dateStr)}</span>
      </div>
      <footer class="png-foot">jadwal-kampus.vercel.app · data hanya di browser kamu</footer>
    </div>`;
  document.body.appendChild(poster);

  const restore = () => poster.remove();

  html2canvas(poster, {
    backgroundColor: '#ffffff',
    scale: Math.min(3, (window.devicePixelRatio * 2) || 2),
    useCORS: true,
    logging: false,
    width: poster.scrollWidth,
    height: poster.scrollHeight,
    windowWidth: poster.scrollWidth,
    windowHeight: poster.scrollHeight,
  }).then(c => {
    restore();
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'jadwal-kampus.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Gambar jadwal diunduh 🖼️');
  }).catch(() => {
    restore();
    toast('Gagal ekspor PNG — coba PDF / Cetak');
  });
});

$('btnPrint').addEventListener('click', () => window.print());

/* ============================================================
   NORMALISASI (parse Excel/CSV) — battle-tested, preserved
   ============================================================ */
function normDayLoose(s){
  s=String(s||'').toLowerCase();
  const hit=s.match(/\b(senin|selasa|slasa|rabu|kamis|jum'at|jumat|sabtu|saptu|minggu|ahad)\b/);
  if(!hit)return '';
  const w=hit[1]||hit[0];
  if(w.startsWith('sen'))return 'Senin';
  if(w.startsWith('sel')||w==='slasa')return 'Selasa';
  if(w.startsWith('rab'))return 'Rabu';
  if(w.startsWith('kam'))return 'Kamis';
  if(w.startsWith('jum'))return 'Jumat';
  if(w.startsWith('sab')||w.startsWith('sap'))return 'Sabtu';
  return 'Minggu';
}
// Ambil nama hari yang TERTANAM di dalam sel campuran, mis. "Senin, 08:00-10:30",
// "Selasa 10.30-13.00", atau "Senin/08:00". Dipakai saat kolom hari tidak ada
// atau kosong — tanpa ini seluruh baris kehilangan harinya. Sengaja butuh nama
// hari UTUH (bukan 3 huruf) agar tidak salah tangkap nama matkul seperti
// "Selisih" / "Rabdasan" (bug lama yang membuat semua jadi Senin).
function dayInCell(s){
  const t=String(s||'').toLowerCase();
  const m=t.match(/\b(senin|selasa|slasa|rabu|kamis|jumat|sabtu|saptu|minggu|ahad)\b/);
  if(!m)return '';
  const w=m[1];
  if(w.startsWith('sen'))return 'Senin';
  if(w.startsWith('sel')||w==='slasa')return 'Selasa';
  if(w.startsWith('rab'))return 'Rabu';
  if(w.startsWith('kam'))return 'Kamis';
  if(w.startsWith('jum'))return 'Jumat';
  if(w.startsWith('sab')||w.startsWith('sap'))return 'Sabtu';
  return 'Minggu';
}
function normDay(v){
  // Excel sering menyimpan kolom "Hari" sebagai ANGKA 1-7 (bukan teks). Tanpa ini
  // seluruh kolom hari jadi kosong walau datanya ada. cellText() sengaja TIDAK
  // mengubah angka 1-7 jadi nama hari (bisa merusak SKS), jadi konversinya di sini.
  // Nilainya bisa datang sebagai number ATAU string "1" (lewat cellText), jadi
  // diperiksa SEBELUM huruf dibersihkan di bawah.
  const raw=String(v??'').trim();
  if(/^[1-7]$/.test(raw))return HARI[+raw-1];
  const s=raw.toLowerCase().replace(/[^a-z]/g,'');
  const m={senin:'Senin',selasa:'Selasa',slasa:'Selasa',rabu:'Rabu',kamis:'Kamis',jumat:'Jumat',sabtu:'Sabtu',saptu:'Sabtu',minggu:'Minggu',ahad:'Minggu'};
  const short={sen:'Senin',sel:'Selasa',rab:'Rabu',kam:'Kamis',jum:'Jumat',sab:'Sabtu',min:'Minggu'};
  if(m[s])return m[s];
  if(s.length<=10)return short[s.slice(0,3)]||'';
  return normDayLoose(v);
}
function normTipe(v,def){
  const s=String(v||'').toLowerCase().trim();
  if(!s)return def||'Teori';
  // whole-word / boundary matching to avoid false positives
  // (e.g. old /teo/ matched "video", "stereo"; /prak/ was fine)
  if(/\b(prak|praktik|praktikum|lab|laboratorium|practic)\b/i.test(s))return 'Praktikum';
  if(/\b(teo|teori|theory|kuliah|lecture|class|reguler)\b/i.test(s))return 'Teori';
  // also match exact equals (case already lowered) for short codes like P/T
  if(s==='p'||s==='pr')return 'Praktikum';
  if(s==='t'||s==='th')return 'Teori';
  return def||'Teori';
}
// Deteksi tipe saat KOLOM TIPE TIDAK ADA / KOSONG, berurutan: nama matkul lalu kode.
// - Nama matkul: cari kata utuh "praktikum"/"praktik"/"lab" (bukan substring, agar
//   "Kolaborasi" tidak dianggap lab).
// - Kode: huruf P di AKHIR kode praktikum di hampir semua kampus (IF301 vs IF301P).
// Mengembalikan '' bila tidak yakin → pemanggil memakai default.
function inferTipe(matkul,kode){
  const t=String(matkul||'').toLowerCase();
  if(/\b(praktikum|praktik|prakt|practicum|practice|lab|laboratorium)\b/.test(t))return 'Praktikum';
  if(/\b(teori|theory|lecture|kuliah)\b/.test(t))return 'Teori';
  // kode: IF301P / IF301-P / IF301.P => praktikum. Hanya bila alfanumerik tegas.
  const k=String(kode||'').toUpperCase().replace(/\s+/g,'');
  if(/^[A-Z]{0,4}\d{2,5}\s*[-._]?\s*P$/.test(k))return 'Praktikum';
  if(/^[A-Z]{0,4}\d{2,5}\s*[-._]?\s*T$/.test(k))return 'Teori';
  return '';
}
function normTime(v){
  let s=String(v??'').trim().toUpperCase().replace(/\./g,':').replace(/\s+/g,'');
  if(!s)return '';
  let ap='';const am=s.match(/^(.*?)(AM|PM|A\.M\.|P\.M\.)$/);if(am){s=am[1].trim();ap=am[2][0]}
  if(/^[A-Z]+$/.test(s))return '';
  let m=s.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/);
  if(!m){const hm=s.match(/^(\d{3,4})$/);if(hm){const t=hm[1].padStart(4,'0');m=[0,t.slice(0,2),t.slice(2)]}}
  if(m){let h=+m[1],mi=+(m[2]??0);if(ap==='P'&&h<12)h+=12;if(ap==='A'&&h===12)h=0;if(h>23||mi>59)return '';return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')}
  return '';
}
function splitTimes(v){
  const s=String(v??'').trim().replace(/\./g,':');
  const m=s.match(/(\d{1,2}:\d{1,2}(?::\d{1,2})?)\s*[-–—]\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?)/);
  if(m)return[normTime(m[1]),normTime(m[2])];
  const t=normTime(s);return[t,''];
}
// Jam yang JELAS jam (bukan sekadar angka). Dipakai untuk menggabungkan kolom jam
// terpisah: "3" pada kolom SKS juga lolos normTime() sebagai "03:00", jadi di sini
// wajib ada titik dua ("08:00"/"08.00") atau 4 digit HHMM ("0800").
function clockTime(v){
  const s=String(v??'').trim();
  if(!/\d/.test(s))return '';
  if(/^\d{1,2}[:.]\d{1,2}([:.]\d{1,2})?$/.test(s)||/^\d{4}$/.test(s))return normTime(s);
  return '';
}
function cellText(v){
  if(v==null||v==='')return '';
  if(typeof v==='boolean')return v?'Ya':'';
  if(v instanceof Date&&!isNaN(v))return String(v.getUTCHours()).padStart(2,'0')+':'+String(v.getUTCMinutes()).padStart(2,'0');
  if(typeof v==='number'){
    if(!isFinite(v))return '';
    // v>0 && v<1 = Excel time fraction (e.g. 0.375 = 09:00). Convert to HH:MM.
    if(v>0&&v<1){const m=Math.round(v*24*60);return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
    // NOTE: integer 1-7 is NOT auto-converted to a day name here — that would
    // corrupt SKS values 1-7. Day-from-number is handled by normDay() at the
    // hari column read site instead. (BUG found via E2E test: SKS=3 -> 'Rabu'.)
    return String(v);
  }
  return String(v).trim().replace(/\s+/g,' ');
}
function normHead(h){return String(h??'').toLowerCase().trim().replace(/\s+/g,' ')}
function aliasIdx(head,names){
  let best=-1,bestScore=-1;
  for(let i=0;i<head.length;i++){
    const h=normHead(head[i]);if(!h)continue;
    for(const n of names){
      let s=-1;
      if(h===n)s=1000+n.length*10;
      else if(h.startsWith(n+' ')||h.startsWith(n+'/')||h.startsWith(n+'(')||h.startsWith(n+':')||h.startsWith(n+'-'))s=800+n.length*10;
      else if(h.endsWith(' '+n)||h.endsWith('/'+n)||h.endsWith('('+n)||h.endsWith(':'+n))s=700+n.length*10;
      else if(h.includes(' '+n+' ')||h.includes('/'+n+'/')||h.includes('('+n+')'))s=600+n.length*10;
      else if(h.includes(n)&&h.length<=n.length+8)s=100+n.length*10;
      if(s>bestScore){bestScore=s;best=i}
    }
  }
  return bestScore>=100?best:-1;
}
function detectHeader(rows){
  const keys=['matkul','mapel','mata kuliah','kode','sks','hari','jam','mulai','selesai','sampai','kelas','ruang','room','dosen','prodi','jurusan','tipe','jenis','waktu','pukul'];
  let best=-1,bestHits=-1;
  for(let i=0;i<Math.min(rows.length,10);i++){
    const row=(rows[i]||[]).map(x=>normHead(x));
    const hits=keys.filter(k=>row.some(c=>c===k||c.startsWith(k+' ')||c.startsWith(k+'/')||c.endsWith(' '+k)||c.includes(' '+k+' '))).length;
    if(hits>bestHits){bestHits=hits;best=i}
  }
  // Nothing header-looking at all → return -1 so the caller knows "headerless"
  // and starts reading from row 0. Returning 0 here was ambiguous: it meant both
  // "header is row 0" and "no header", so headerless files silently lost row 0
  // (e.g. a 3-row paste imported only 2 rows).
  if(bestHits<3)return -1;
  // Reject pure-title rows: a real header row has multiple short header cells,
  // a title row usually has one long cell with the rest empty.
  const hdr=(rows[best]||[]).map(x=>normHead(x)).filter(x=>x!=='');
  if(hdr.length<3)return -1;
  return best;
}
// Headerless files: the widest row is usually a data row. Find its first cell so
// the "!matkul" fallback below picks a real class name, not an empty first column.
function firstDataRow(rows,from,to){
  let bi=-1,bl=-1;
  for(let i=from;i<to;i++){const L=(rows[i]||[]).filter(c=>cellText(c)!=='').length;if(L>bl){bl=L;bi=i}}
  return bi;
}
function parseCSVText(t){
  t=String(t||'').replace(/^\uFEFF/,'');
  let lines=t.split(/\r?\n/).filter(l=>l.trim()!=='');
  if(!lines.length)return[];
  // Tempelan dari portal kampus tidak selalu punya tab: kalau kolom "ngumpul" jadi
  // satu sel, mungkin pemisahnya sebenarnya spasi bertingkat atau baris tanpa sel
  // kosong. Coba rapikan dulu, pakai versi yang kolomnya LEBIH BANYAK \u2014 kalau tidak
  // deteksi delimiter di bawah akan jatuh ke koma dan seluruh baris jadi 1 kolom.
  const better = alt => Math.min(...alt.slice(0,5).map(l=>l.split(/\t/).length)) > Math.min(...lines.slice(0,5).map(l=>l.split(/\t/).length));
  const byGap = lines.map(l=>l.replace(/[ ]{2,}|\u00A0{2,}/g,'\t'));
  if (better(byGap)) lines = byGap;
  const cands=[';','\t','|',','];let bestD=',',bestScore=-1e9;
  for(const d of cands){
    const cols=lines.slice(0,5).map(l=>l.split(d).length);
    const dev=cols.reduce((a,b)=>a+Math.abs(b-cols[0]),0);
    // Rata-rata kolom, bukan minimum: teks di dalam sel CSV boleh mengandung koma
    // ("Algoritma, Lanjut") sehingga SATU baris punya kolom lebih banyak dan min()
    // jadi 1 untuk semua delimiter — deteksi selalu jatuh ke koma. Rata-rata tetap
    // menang untuk delimiter yang benar, dan konsistensi (dev kecil) mengunci pilihan.
    const avg=cols.reduce((a,b)=>a+b,0)/cols.length;
    const score=avg*10-dev;if(score>bestScore){bestScore=score;bestD=d}
  }
  return lines.map(l=>{
    const out=[];let cur='',q=false;
    for(let i=0;i<l.length;i++){
      const c=l[i];
      if(c==='"'){if(q&&l[i+1]==='"'){cur+='"';i++}else q=!q}
      else if(c===bestD&&!q){out.push(cur);cur=''}
      else cur+=c;
    }
    out.push(cur);return out.map(s=>s.trim());
  });
}
const COLS={
  matkul:['mata kuliah','nama matkul','nama mk','matkul','mapel','subject','nama mata kuliah'],
  kode:['kode mk','kode matkul','kode','code'],
  sks:['sks','bobot','kredit'],
  hari:['hari','day'],
  tipe:['tipe','jenis','kategori','type'],
  mulai:['jam mulai','mulai jam','mulai','waktu mulai','jam','waktu','pukul','start'],
  selesai:['jam selesai','selesai jam','selesai pukul','selesai','sampai','s/d','sampai jam','akhir','selesai sampai','end'],
  kelas:['kelas','class','rombel','grup','group'],
  ruang:['ruang','ruangan','room','lokasi','lab','tempat'],
  dosen:['nama dosen','dosen','pengajar','pengampu','lecturer'],
  prodi:['program studi','prodi','jurusan','fakultas','program']
};
function importRows(rows,tipeDefault,target){
  if(!Array.isArray(target))target=data;
  const hi=detectHeader(rows);
  const head=((hi>=0?rows[hi]:rows[0])||[]).map(x=>String(x??'').toLowerCase().trim());
  const ix={};for(const k in COLS)ix[k]=aliasIdx(head,COLS[k]);
  if(ix.matkul<0){
    ix.matkul=0;
    const bi=firstDataRow(rows,0,rows.length);
    if(bi<0||!rows[bi])return{n:0,lewat:0,headerRow:hi};
  }
  let n=0,lewat=0;const usedCols=new Set(Object.values(ix).filter(v=>v>=0));
  // Detect if there's a dedicated hari column
  const hasHariCol = ix.hari >= 0;
  // For merged-cell / row-per-day layouts: carry last day value downward
  let lastHari='';
  // Header at row 0 is unambiguous; -1 means headerless → read every row.
  const startIdx = hi >= 0 ? hi+1 : 0;
  for(let i=startIdx;i<rows.length;i++){
    const r=rows[i]||[];
    if(!r.some(c=>cellText(c)!==''))continue;
    const g=k=>ix[k]<0?'':cellText(r[ix[k]]);
    let rowBlob=r.map(cellText).join(' | ');
    let matkul=g('matkul');
    // --- HARI: read from hari column if it exists (carry merged-cell values down) ---
    const hariRaw=g('hari');
    const hariCell=normDay(hariRaw);
    let hari=hariCell||'';
    // If this row is ONLY a day name (row-per-day header), remember it and skip as data.
    // hariCell comes from the hari column when it exists; if there's no hari column,
    // also scan the matkul cell / row blob for a standalone day name.
    const dayFromRow = hariCell || (!hasHariCol ? (normDay(matkul) || dayInCell(matkul) || '') : '');
    const onlyDay = dayFromRow && !matkul && r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c)) || !cellText(c));
    if (onlyDay) { lastHari=dayFromRow; continue; }
    // also catch: no hari column but the row's matkul cell IS just a day name
    if (!hasHariCol && !hariCell && matkul) {
      const mDay = normDay(matkul) || dayInCell(matkul);
      if (mDay && r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c)) || !cellText(c))) {
        lastHari=mDay; continue;
      }
    }
    // carry last day down when the hari cell is blank/merged
    if (hasHariCol && !hariCell && hariRaw === '') hari = lastHari || '';
    // Kolom hari kosong / tidak ada kolom hari: cari nama hari yang tertanam di
    // sel mana pun (mis. "Senin, 08:00-10:30" atau "Senin/08:00").
    if (!hari) {
      for (const c of r) { const d = dayInCell(cellText(c)); if (d) { hari = d; break; } }
    }
    // --- end HARI ---
    const mulaiCell=g('mulai'),selesaiCell=g('selesai');
    let tm1=clockTime(mulaiCell),tm2=clockTime(selesaiCell);
    // 1) Kolom "mulai"/"selesai" berisi RENTANG, mis. "08:00-10:30".
    if(!(tm1&&tm2)){const rng=splitTimes(mulaiCell);if(rng[0]&&rng[1]){tm1=rng[0];tm2=rng[1]}}
    if(!(tm1&&tm2)){const rng=splitTimes(selesaiCell);if(rng[0]&&rng[1]){tm1=rng[0];tm2=rng[1]}}
    // 2) Seluruh baris berisi satu rentang, mis. kolom "Jadwal" = "Senin, 08:00-10:30".
    if(!(tm1&&tm2)){for(const c of r){const t=splitTimes(cellText(c));if(t[0]&&t[1]){tm1=t[0];tm2=t[1];break}}}
    // 3) Kolom jam TERPISAH tanpa header jam (mis. "08:00" lalu "10:30" di kolom
    //    berurutan). Ambil dua jam sah pertama/kedua — clockTime() menolak "3" (SKS).
    if(!(tm1&&tm2)){
      const clocks=[];
      for(let c=0;c<r.length;c++){const t=clockTime(cellText(r[c]));if(t)clocks.push({c,t})}
      if(clocks.length>=2){tm1=tm1||clocks[0].t;tm2=tm2||clocks[1].t;
        usedCols.add(clocks[0].c);usedCols.add(clocks[1].c);}
      else if(clocks.length===1&&!tm1)tm1=clocks[0].t;
    }
    // 3b) Jaring terakhir: rentang apa pun di dalam teks baris.
    if(!(tm1&&tm2)){const any=rowBlob.match(/(\d{1,2}[:.]\d{1,2})\s*[-–—]\s*(\d{1,2}[:.]\d{1,2})/);if(any){tm1=tm1||normTime(any[1]);tm2=tm2||normTime(any[2])}}
    if(!matkul){
      const dtOnly=/^\s*(\d{1,2}[:.]\d{1,2})(\s*[-–—]\s*(\d{1,2}[:.]\d{1,2}))?\s*$/.test(rowBlob.replace(/\|/g,' ').trim())||/^\s*(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s*$/i.test(rowBlob.replace(/\|/g,' ').trim());
      if(dtOnly)continue;
      matkul=rowBlob.split('|').map(s=>s.trim()).filter(s=>s&&!normDay(s)&&!splitTimes(s)[0]&&!/^\d+([.,]\d+)?$/.test(s)).sort((a,b)=>b.length-a.length)[0]||'';
      if(!matkul){lewat++;continue}
    }
    // NOTE: We intentionally do NOT guess a day from the matkul name / row blob.
    // The old logic used a 3-letter regex (sen/sel/rab/kam/jum/sab/min) which
    // caused false positives on matkul names like "Selisih", "Rabdasan",
    // "Kamputer" and made everything fall back to "Senin".
    // Day now only comes from: (a) the hari column, (b) carry-down of a merged
    // day header row, or (c) a standalone day-name row detected above.
    if (hari) { lastHari = hari; }
    else if (!hasHariCol) {
      // No hari column at all in the whole sheet — fall back to last seen day,
      // otherwise leave blank (rendered as '-' / unknown) instead of forcing Senin.
      hari = lastHari || '';
    }
    const tm1m=toMin(tm1),tm2m=toMin(tm2);
    if(!isNaN(tm1m)&&!isNaN(tm2m)&&tm2m<tm1m){const t=tm1;tm1=tm2;tm2=t}
    // BUG-3.4: a data row must have at least one valid time — otherwise it's not a class
    if(isNaN(tm1m)&&isNaN(tm2m)){lewat++;continue}
    // Tipe: kolom tipe menang; kalau kosong tebak dari nama matkul lalu kode;
    // kalau masih ragu pakai default (yang kini hanya "teori").
    const tipeCell=g('tipe');
    const tipe=(tipeCell?normTipe(tipeCell,''):'')||inferTipe(matkul,g('kode'))||normTipe('',tipeDefault);
    let sks=parseInt(String(g('sks')).replace(',','.'),10);
    if(isNaN(sks))sks=tipe==='Praktikum'?1:2;   // praktikum biasanya 1 SKS
    target.push({id:uid(),matkul,kode:g('kode'),sks,hari,tipe,mulai:tm1,selesai:tm2,kelas:g('kelas'),ruang:g('ruang'),dosen:g('dosen'),prodi:g('prodi')});
    n++;
  }
  return{n,lewat,headerRow:hi};
}

/* ============================================================
   IMPORT EXCEL/CSV
   ============================================================ */
function importExcel(fileId,previewId,dropId,tipeDefault,tipeLabel,intoMaster){
  const f=$(fileId).files[0];
  if(!f)return toast('Pilih file Excel/CSV dulu untuk '+tipeLabel);
  if(typeof XLSX==='undefined'){toast('Pustaka Excel belum termuat — cek internet lalu refresh');return}
  $(previewId).textContent='⏳ Membaca '+f.name+' ...';
  const reset=()=>{try{$(fileId).value=''}catch(_){}clearFile(dropId)};
  const rd=new FileReader();
  rd.onerror=()=>{reset();toast('Gagal membaca file')};
  rd.onload=e=>{
    try{
      let rowsList=null; // daftar sheet/lembar; satu file bisa punya >1 sheet
      const isCSV=/\.csv$/i.test(f.name)||String(f.type||'').includes('csv');
      if(isCSV){
        const buf=new Uint8Array(e.target.result);let text='';
        try{text=new TextDecoder('utf-8').decode(buf)}catch(_){text=Array.from(buf).map(b=>String.fromCharCode(b)).join('')}
        rowsList=[parseCSVText(text)];
      }else{
        const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
        if(!wb.SheetNames.length)throw new Error('tidak ada sheet di file');
        rowsList=[];
        for(const nm of wb.SheetNames){
          const ws=wb.Sheets[nm];
          if(!ws||!ws['!ref'])continue;
          const rr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:false});
          if(rr&&rr.length)rowsList.push(rr);
        }
      }
      const rows=rowsList&&rowsList[0];
      if(!rows||!rows.length)throw new Error('file kosong / tidak terbaca');
      if(intoMaster){
        master=[];
        let n=0,lewat=0;
        for(const rs of rowsList){const r=importRows(rs,tipeDefault,master);n+=r.n;lewat+=r.lewat}
        const r={n,lewat};
        reset();saveMaster();
        $(previewId).textContent='✓ '+r.n+' baris master tersimpan.'+(r.lewat?' ('+r.lewat+' dilewati)':'');
        toast(r.n?r.n+' baris master tersimpan ✓':'Tidak ada baris valid');
        if(kodePicks.length)regenFromMaster();
      }else{
        let n=0,lewat=0,hi=0;
        for(const rs of rowsList){const r=importRows(rs,tipeDefault,data);n+=r.n;lewat+=r.lewat;if(r.headerRow>0)hi=r.headerRow}
        const r={n,lewat,headerRow:hi};
        reset();save();render();
        $(previewId).textContent='✓ '+r.n+' baris '+tipeLabel+' ditambahkan.'+(r.lewat?' ('+r.lewat+' tanpa nama dilewati)':'')+(r.headerRow>0?' (header baris '+(r.headerRow+1)+')':'');
        toast(r.n?r.n+' jadwal '+tipeLabel+' ditambahkan ✓':'Tidak ada baris valid — cek format kolom');
      }
    }catch(err){
      reset();
      $(previewId).textContent='✗ GAGAL: '+err.message;
      toast('Gagal baca file: '+err.message);
    }
  };
  rd.readAsArrayBuffer(f);
}
/* ============================================================
   IMPORT JADWAL (1 kartu, multi-file, anti-duplikat, XLSX/CSV/PDF)
   - readFileRows: baca 1 file → rows[][] (CSV/XLSX pakai parser lama;
     PDF pakai PDF.js dynamic import lalu umpan text ke parseCSVText).
   - importJadwalMulti: proses FileList, lewati file yang sudah diproses,
     catat file sukses di processedFiles (persisten, anti-duplikat tahan reload).
   ============================================================ */
async function readFileRows(file){
  const isCSV=/\.csv$/i.test(file.name)||String(file.type||'').includes('csv');
  const isPDF=/\.pdf$/i.test(file.name)||String(file.type||'').includes('pdf');
  const buf=await file.arrayBuffer();
  const key=hashBytes(new Uint8Array(buf)); // key anti-duplikat = hash ISI file
  if(isPDF){
    // PDF.js v6 = ESM-only (.mjs). Dynamic import supaya 520KB lib cuma dimuat
    // saat ada PDF, bukan tiap load halaman. Worker di-set ke URL jsdelivr sama.
    let lib;
    try{ lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.min.mjs'); }
    catch(_){ throw new Error('Pustaka PDF belum termuat — cek internet lalu refresh'); }
    lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/pdf.worker.min.mjs';
    const pdf=await lib.getDocument({data:new Uint8Array(buf)}).promise;
    const lines=[];
    for(let pNum=1;pNum<=pdf.numPages;pNum++){
      const page=await pdf.getPage(pNum);
      const tc=await page.getTextContent(); // items: {str, transform:[a,b,c,d,x,y], width}
      // kelompokkan per baris (y sama ±2px), urut per x
      const rows={};
      for(const it of tc.items){
        if(!it.str || !it.str.trim()) continue;
        const y=Math.round(it.transform[5]);
        (rows[y]=rows[y]||[]).push({x:it.transform[4], s:it.str});
      }
      const ys=Object.keys(rows).map(Number).sort((a,b)=>b-a); // y besar = atas
      for(const y of ys){
        const segs=rows[y].sort((a,b)=>a.x-b.x);
        // sisipkan tab antar-segmen jarak jauh agar parseCSVText gap-aligned
        // menangkap kolom (lihat parseCSVText: [ ]{2,}| {2,} → tab).
        let line='';
        for(let i=0;i<segs.length;i++){
          if(i>0 && (segs[i].x - segs[i-1].x) > 30) line+='\t';
          line+=segs[i].s;
        }
        line=line.trim();
        if(line) lines.push(line);
      }
    }
    if(!lines.length) throw new Error('PDF tidak berisi teks terpilih (kemungkinan scan gambar) — coba file Excel/CSV atau PDF hasil export');
    return { rows: parseCSVText(lines.join('\n')), key };
  }
  if(isCSV){
    let text; try{ text=new TextDecoder('utf-8').decode(new Uint8Array(buf)); }catch(_){ text=Array.from(new Uint8Array(buf)).map(b=>String.fromCharCode(b)).join(''); }
    return { rows: parseCSVText(text), key };
  }
  if(typeof XLSX==='undefined') throw new Error('Pustaka Excel belum termuat — cek internet lalu refresh');
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  if(!wb.SheetNames.length) throw new Error('tidak ada sheet di file');
  // Baca SEMUA sheet: sebagian file Labkom menaruh Teori di sheet 1 dan Praktikum
  // di sheet 2 — dulu hanya sheet pertama dibaca sehingga praktikum hilang.
  const sheets=[];
  for(const nm of wb.SheetNames){
    const ws=wb.Sheets[nm];
    if(!ws||!ws['!ref'])continue;
    const rr=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:false});
    if(rr&&rr.length)sheets.push(rr);
  }
  if(!sheets.length) throw new Error('sheet kosong / tidak terbaca');
  return { sheets, rows: sheets[0], key };
}

async function importJadwalMulti(){
  const fl=$('fileJadwal').files;
  if(!fl||!fl.length) return toast('Pilih file jadwal dulu (teori/praktikum/PDF)');
  if(fl.length>4) return toast('Maksimal 4 file sekaligus — hapus yang kelebihan');
  // Tipe selalu dipindai otomatis (tidak ada pilihan default di UI). 'Teori'
  // hanya jaring terakhir bila kolom/nama/kode semuanya tidak menyebut tipe.
  const tipeDefault='Teori';
  let total=0,skipFiles=[],errFiles=[],parts=[];
  $('previewJadwal').textContent='⏳ Memproses '+fl.length+' file ...';
  for(const f of fl){
    try{
      const { rows, sheets, key }=await readFileRows(f);
      if(processedFiles.has(key)){ skipFiles.push(f.name); continue; }
      if(!rows||!rows.length){ errFiles.push(f.name+' (kosong/tak terbaca)'); continue; }
      const lists=(sheets&&sheets.length)?sheets:[rows];
      let fn=0,fl2=0;
      for(const rs of lists){
        const r=importRows(rs,tipeDefault,data); // data=append; tipe auto per baris
        fn+=r.n;fl2+=r.lewat;
      }
      if(!fn){ errFiles.push(f.name+' (0 baris valid)'); continue; }
      total+=fn;
      parts.push(`${f.name}: ${fn} baris`+(fl2?` (${fl2} dilewati)`:'')+(lists.length>1?` dari ${lists.length} sheet`:''));
      processedFiles.add(key); // catat SETELAH sukses → anti-duplikat (hash isi)
    }catch(e){ errFiles.push(f.name+': '+e.message); }
  }
  saveProcessed();
  if(total){ save(); render(); }
  // preview: hasil per file + skip + error. JANGAN clear input.value (file tetap).
  let msg=parts.length?'✓ '+parts.join(' • '):'';
  if(skipFiles.length) msg+=(msg?' | ':'')+'⏭️ sudah diproses (dilewati): '+skipFiles.join(', ');
  if(errFiles.length) msg+=(msg?' | ':'')+'✗ gagal: '+errFiles.join(', ');
  if(!msg) msg='Tidak ada baris valid dari file terpilih.';
  $('previewJadwal').textContent=msg;
  toast(total?total+' jadwal ditambahkan ✓':(skipFiles.length?'File sudah diproses, dilewati':'Tidak ada baris valid'));
}
$('btnImport').addEventListener('click', importJadwalMulti);

/* ============================================================
   DRAG & DROP
   ============================================================ */
// store the drop zone <-> file input mapping so the ✕ clear button works
const DROP_MAP = { dropJadwal:'fileJadwal', dropMaster:'fileMaster' };
// ringkas FileList jadi label tampilan: "nama.ext" atau "nama.ext +N lainnya"
function fileListLabel(fl){
  if(!fl||!fl.length) return { name:'', text:'' };
  const first=fl[0];
  const name = fl.length>1 ? `${first.name} +${fl.length-1} lainnya` : first.name;
  return { name, text:fl.length+' file — klik tombol Proses.' };
}
function paintDrop(dropId,file){
  const el=$(dropId);if(!el)return;
  if(file){
    el.classList.add('filled');
    el.innerHTML=`<span class="drop-main">📄 <b>${esc(file.name)}</b></span><small>${esc(friendlySize(file.size))} • klik untuk ganti / drag file lain</small><button type="button" class="drop-clear" data-clear="${dropId}" title="Hapus file" aria-label="Hapus file">✕</button>`;
    const clr=el.querySelector('.drop-clear');if(clr)clr.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();clearFile(dropId);});
  }else{
    el.classList.remove('filled');
    const label = dropId==='dropJadwal'
      ? '📤 <b>Pilih file jadwal</b><small>klik / drag ke sini (XLSX, XLS, CSV, PDF) — maks 4 file</small>'
      : '📤 <b>Pilih file jadwal lengkap</b><small>Excel/CSV semua kelas dari Labkom/SIA</small>';
    el.innerHTML=label;
  }
}
function clearFile(dropId){
  const inputId=DROP_MAP[dropId]; if(!inputId)return;
  const inp=$(inputId); try{inp.value=''}catch(_){}
  paintDrop(dropId,null);
  const map={dropJadwal:['previewJadwal','fileNameJadwal'],dropMaster:['previewMaster','fileNameMaster']};
  const [prevId,fnId]=map[dropId]||['',''];
  $(prevId).textContent='';
  $(fnId).textContent='Belum ada file dipilih';
  $(fnId).classList.remove('ok');
}
function friendlySize(b){
  if(!b&&b!==0)return '';
  if(b<1024)return b+' B';
  if(b<1048576)return (b/1024).toFixed(0)+' KB';
  return (b/1048576).toFixed(1)+' MB';
}
[['fileJadwal','previewJadwal','dropJadwal','fileNameJadwal'],['fileMaster','previewMaster','dropMaster','fileNameMaster']].forEach(([f,p,d,fn])=>{
  $(f).addEventListener('change',()=>{
    const fl=$(f).files; paintDrop(d,fl[0]||null);
    if(fl&&fl.length){
      const lab=fileListLabel(fl);
      $(p).textContent='Siap diproses: '+lab.text;
      $(fn).textContent=lab.name; $(fn).classList.add('ok');
    }
  });
});
function armDrop(dropId,inputId){
  const z=$(dropId);if(!z)return;
  ['dragenter','dragover'].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.add('over')}));
  ['dragleave','drop'].forEach(ev=>z.addEventListener(ev,e=>{e.preventDefault();z.classList.remove('over')}));
  z.addEventListener('drop',e=>{
    const fl=e.dataTransfer&&e.dataTransfer.files;
    if(fl&&fl.length){
      $(inputId).files=fl;paintDrop(dropId,fl[0]);
      const map={fileJadwal:['previewJadwal','fileNameJadwal'],fileMaster:['previewMaster','fileNameMaster']};
      const [prev,fn]=map[inputId]||['',''];
      const lab=fileListLabel(fl);
      $(prev).textContent='Siap diproses: '+lab.text;
      $(fn).textContent=lab.name; $(fn).classList.add('ok');
    }
  });
}
armDrop('dropJadwal','fileJadwal');armDrop('dropMaster','fileMaster');

/* ============================================================
   INIT
   ============================================================ */
if(window.innerWidth>900)$('filterBody').classList.add('open');
render();

/* live update "hari ini" + "LIVE now" marker every minute — but skip when a modal
   is open, the tab is hidden, the user is typing, or there are no today's classes
   (nothing to refresh), to avoid wasteful DOM rebuilds. */
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (document.querySelector('.modal:not(.hidden)')) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
  const todayKey = HARI[(new Date().getDay() + 6) % 7];
  if (!data.some(d => d.hari === todayKey)) return; // nothing live to update
  render();
}, 60000);

/* ============================================================
   PWA — service worker + install prompt + offline/online indicator
   - Daftar SW untuk offline support (shell ter-cache).
   - Banner atas: "🔒 Offline — perubahan tersimpan lokal" saat koneksi mati,
     hilang otomatis saat online kembali. Klik ✕ = tutup sesi ini.
   - Install prompt: tangkap beforeinstallprompt, tampilkan tombol "Install".
     Chrome hanya munculkan event ini sekali (atau tiap dismiss) — kita hormati
     & jangan spam: setelah dismiss/install, sembunyikan sesi ini (sessionStorage).
   ============================================================ */
const pwaBar = $('pwaBar'), pwaMsg = $('pwaMsg'), pwaAction = $('pwaAction');
function pwaShow(msg, { offline = false, actionLabel = '', actionCb = null } = {}) {
  pwaMsg.textContent = msg;
  pwaBar.classList.toggle('offline', offline);
  pwaBar.classList.remove('hidden');
  if (actionLabel && actionCb) {
    pwaAction.textContent = actionLabel;
    pwaAction.classList.remove('hidden');
    pwaAction.onclick = actionCb;
  } else {
    pwaAction.classList.add('hidden');
    pwaAction.onclick = null;
  }
}
function pwaHide() { pwaBar.classList.add('hidden'); }
$('pwaClose').addEventListener('click', () => pwaHide());

// offline/online detection. Periksa navigator.onLine di load lalu dengarkan
// event online/offline. Beberapa browser menganggap "online" walau jaringan
// mati (link-local) — tapi untuk PWA statis ini sudah cukup sebagai sinyal.
function updateOnline() {
  if (navigator.onLine) {
    // hanya tutup kalau banner yg sedang tampil adalah banner offline
    if (pwaBar.classList.contains('offline')) pwaHide();
  } else {
    pwaShow('🔒 Offline — semua perubahan tetap tersimpan di browser kamu', { offline: true });
  }
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

// install prompt. Cache event-nya; tampilkan tombol "Install app".
let deferredPrompt = null;
const INSTALL_FLAG = 'jk-pwa-install-dismissed';
window.addEventListener('beforeinstallprompt', (e) => {
  // hormati: jangan munculkan lagi di sesi yg sama kalau user sudah pernah dismiss
  if (sessionStorage.getItem(INSTALL_FLAG)) return;
  e.preventDefault();
  deferredPrompt = e;
  pwaShow('📲 Jadwal Kampus bisa dipasang di perangkat kamu — pakai offline seperti app', {
    actionLabel: 'Install',
    actionCb: async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      sessionStorage.setItem(INSTALL_FLAG, '1'); // accepted or dismissed → jangan ganggu lagi
      deferredPrompt = null;
      pwaHide();
    }
  });
});
window.addEventListener('appinstalled', () => {
  sessionStorage.setItem(INSTALL_FLAG, '1');
  pwaHide();
  toast('App terpasang ✓ — akses dari home screen');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // kalau ada update SW baru menunggu, tampilkan tombol update
      if (reg.waiting) pwaOfferUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && reg.waiting) pwaOfferUpdate(reg);
        });
      });
    }).catch(() => {});
    // dengarkan pesan dari SW (skipWaiting done → reload otomatis)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // SW baru mengambil alih → reload sekali supaya shell baru dipakai
      if (!sessionStorage.getItem('jk-sw-reloading')) {
        sessionStorage.setItem('jk-sw-reloading', '1');
        location.reload();
      }
    });
  });
}
function pwaOfferUpdate(reg) {
  if (sessionStorage.getItem('jk-sw-update-offered')) return;
  sessionStorage.setItem('jk-sw-update-offered', '1');
  pwaShow('🔄 Versi baru tersedia — muat ulang untuk pembaruan', {
    actionLabel: 'Muat ulang',
    actionCb: () => {
      if (reg.waiting) reg.waiting.postMessage('skipWaiting');
      else location.reload();
    }
  });
}

// jalankan cek online sekali di init (setelah elemen pwaBar pasti ada)
updateOnline();
