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

/* ---------- string / time utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toMin = s => { const str=String(s??'').trim(); if(str===''||str===':')return NaN; const p=str.split(':').map(Number); if(isNaN(p[0]))return NaN; return p[0]*60 + (isNaN(p[1])?0:p[1]); };
const sortMin = s => { const m=toMin(s); return isNaN(m)?Infinity:m; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmtTime = s => esc(String(s??'').slice(0,5));

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
  fHariVal = ''; fTipeVal = '';
  $('fProdi').value = ''; $('fKelas').value = '';
  document.querySelectorAll('.chip[data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === ''));
  document.querySelectorAll('#chipHari .chip').forEach(x => x.classList.toggle('on', x.dataset.h === ''));
  render();
});
$('btnHapus').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada data untuk dihapus');
  openConfirm('Hapus SEMUA jadwal?', `Semua ${data.length} jadwal akan dihapus permanen.`, () => {
    data = []; save(); render(); toast('Semua jadwal dihapus ✓');
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

$('btnExportPNG').addEventListener('click', () => {
  if (!data.length) return toast('Belum ada data');
  toast('Membuat gambar... ⏳');
  const target = $('cardTabel');
  if (typeof html2canvas === 'undefined') return toast('Pustaka gambar belum termuat — cek internet');

  // Pastikan konten tabel/kartu tampil untuk capture (di mobile tabel disembunyikan)
  const tw = target.querySelector('.table-wrap');
  const cards = target.querySelector('#cards');
  const prevTableDisp = tw?.style.display;
  const prevCardsDisp = cards?.style.display;
  if (window.innerWidth <= 900 && tw) {
    tw.style.display = 'block';
    if (cards) cards.style.display = 'none';
  }

  html2canvas(target, {
    backgroundColor: '#ffffff',
    scale: Math.min(3, window.devicePixelRatio * 2 || 2),
    useCORS: true,
    logging: false,
    width: target.scrollWidth,
    height: target.scrollHeight,
    windowWidth: target.scrollWidth,
    windowHeight: target.scrollHeight,
    // PAKSA TEMA TERANG saat capture supaya di dark mode gambar tidak jadi hitam.
    // onclone memberi salinan DOM terpisah; kita ubah salinan itu, bukan layar asli.
    onclone: (doc) => {
      const root = doc.documentElement;
      root.setAttribute('data-theme', 'light');
      // override CSS variables di root clone agar pasti terang
      const style = doc.createElement('style');
      style.textContent = `
        [data-theme="light"]{
          --bg:#eef1ff;--bg2:#f8f9ff;--bg3:#eef2ff;--card:#ffffff;
          --ink:#131536;--ink2:#3a3d63;--mut:#6b7194;--line:#e5e8fb;
          --acc:#4f46e5;--acc2:#7c3aed;--ok:#059669;--dan:#dc2626;
          --info:#0ea5e9;--ok-bg:#ecfdf5;--dan-bg:#fef2f2;--info-bg:#f0f9ff;
        }
        *{ background-color:transparent !important; box-shadow:none !important; }
        .card{ background-color:#ffffff !important; }
        .table-wrap,#cards,.jcard,.stat,.toolbar,#cardTabel{ background-color:#ffffff !important; }
        tbody tr:hover{ background:#f8f9ff !important; }
        .ev{ background:linear-gradient(135deg,#131536,#2b2e6b) !important; color:#fff !important; }
        .ev.prak{ background:linear-gradient(135deg,#4f46e5,#7c3aed) !important; }
        .ev.bentrok{ background:linear-gradient(135deg,#dc2626,#991b1b) !important; }
        .badge.Teori{ background:#f0f9ff !important; color:#0369a1 !important; }
        .badge.Praktikum{ background:#f5f3ff !important; color:#6d28d9 !important; }
        tr.bentrok{ background:#fef2f2 !important; }
        .jcard.bentrok{ background:#fef2f2 !important; }
        .pill{ background:linear-gradient(135deg,#4f46e5,#7c3aed) !important; color:#fff !important; }
        .card-head,#tbody,#calendar{ background:#ffffff !important; }
        thead{ background:#eef2ff !important; }
        .muted{ color:#6b7194 !important; }
        /* html2canvas can't render background-clip:text (gradient headings) —
           it would export as invisible text; force a solid ink color instead. */
        .card-head h3{ background:none !important; -webkit-text-fill-color:#131536 !important; -webkit-background-clip:border-box !important; background-clip:border-box !important; color:#131536 !important; }
        /* BUG-4.3/4.4: pastikan card & tabel tidak disembunyikan/dipotong saat capture */
        #cardTabel,#cardKalender{ display:block !important; visibility:visible !important; }
        .table-wrap{ display:block !important; max-height:none !important; overflow:visible !important; }
        .cal-list{ display:flex !important; max-height:none !important; overflow:visible !important; }
        .cal-list.hidden{ display:flex !important; }
      `;
      root.appendChild(style);
    }
  }).then(c => {
    // kembalikan tampilan seperti semula
    if (window.innerWidth <= 900 && tw) {
      if (prevTableDisp !== undefined) tw.style.display = prevTableDisp;
      if (cards) cards.style.display = prevCardsDisp;
    }
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'jadwal-kampus.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('PNG diunduh 🖼️');
  }).catch(() => {
    if (window.innerWidth <= 900 && tw) {
      if (prevTableDisp !== undefined) tw.style.display = prevTableDisp;
      if (cards) cards.style.display = prevCardsDisp;
    }
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
function normDay(v){
  const s=String(v||'').toLowerCase().replace(/[^a-z]/g,'');
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
  const keys=['matkul','mapel','mata kuliah','kode','sks','hari','jam','mulai','selesai','sampai','kelas','ruang','room','dosen','prodi','jurusan'];
  let best=0,bestHits=-1;
  for(let i=0;i<Math.min(rows.length,10);i++){
    const row=(rows[i]||[]).map(x=>normHead(x));
    const hits=keys.filter(k=>row.some(c=>c===k||c.startsWith(k+' ')||c.startsWith(k+'/')||c.endsWith(' '+k)||c.includes(' '+k+' '))).length;
    if(hits>bestHits){bestHits=hits;best=i}
  }
  // require at least 3 distinct known headers AND more hits than any other row
  if(bestHits<3)return 0;
  // also reject pure-title rows: a real header row has multiple short header cells,
  // a title row usually has one long cell with the rest empty
  const hdr=(rows[best]||[]).map(x=>normHead(x)).filter(x=>x!=='');
  if(hdr.length<3)return 0;
  return best;
}
function parseCSVText(t){
  t=String(t||'').replace(/^\uFEFF/,'');
  const lines=t.split(/\r?\n/).filter(l=>l.trim()!=='');
  if(!lines.length)return[];
  const cands=[';','\t','|',','];let bestD=',',bestScore=-1e9;
  for(const d of cands){
    const cols=lines.slice(0,5).map(l=>l.split(d).length);
    const mn=Math.min(...cols);const dev=cols.reduce((a,b)=>a+Math.abs(b-cols[0]),0);
    const score=mn*10-dev;if(score>bestScore){bestScore=score;bestD=d}
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
function importRows(rows,tipeDefault){
  const hi=detectHeader(rows);
  const head=(rows[hi]||[]).map(x=>String(x??'').toLowerCase().trim());
  const ix={};for(const k in COLS)ix[k]=aliasIdx(head,COLS[k]);
  if(ix.matkul<0){
    let bi=hi+1,bl=-1;
    for(let i=hi+1;i<rows.length;i++){const L=(rows[i]||[]).length;if(L>bl){bl=L;bi=i}}
    ix.matkul=0;
    if(!rows[bi])return{n:0,lewat:0,headerRow:hi};
  }
  let n=0,lewat=0;const usedCols=new Set(Object.values(ix).filter(v=>v>=0));
  // Detect if there's a dedicated hari column
  const hasHariCol = ix.hari >= 0;
  // For merged-cell / row-per-day layouts: carry last day value downward
  let lastHari='';
  for(let i=hi+1;i<rows.length;i++){
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
    const dayFromRow = hariCell || (!hasHariCol ? (normDay(matkul) || '') : '');
    const onlyDay = dayFromRow && !matkul && r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c)) || !cellText(c));
    if (onlyDay) { lastHari=dayFromRow; continue; }
    // also catch: no hari column but the row's matkul cell IS just a day name
    if (!hasHariCol && !hariCell && matkul) {
      const mDay = normDay(matkul);
      if (mDay && r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c)) || !cellText(c))) {
        lastHari=mDay; continue;
      }
    }
    // carry last day down when the hari cell is blank/merged
    if (hasHariCol && !hariCell && hariRaw === '') hari = lastHari || '';
    // --- end HARI ---
    const mulaiCell=g('mulai'),selesaiCell=g('selesai');
    let tm=splitTimes(mulaiCell);let tm1=tm[0],tm2=tm[1];
    // splitTimes returns [start,end] from a RANGE like "08:00-10:30".
    // But when mulai/selesai are SEPARATE single-time columns, we get ["08:00",""].
    // So also try the selesai cell as a single end time.
    if(!tm1||!tm2){
      const s2=splitTimes(selesaiCell);
      // s2[0] could be a single end time ("10:30") OR the start of a range in selesai
      if(s2[0]&&!tm1)tm1=s2[0];
      if(s2[1]&&!tm2)tm2=s2[1];      // range end
      else if(s2[0]&&!tm2&&tm1)tm2=s2[0]; // separate-column end time
      else if(s2[0]&&!tm1&&!tm2){tm1=s2[0];} // only selesai has a time
    }
    if(!tm1&&!tm2){for(let c=0;c<r.length;c++){if(usedCols.has(c))continue;const t=splitTimes(cellText(r[c]));if(t[0]&&t[1]){tm1=t[0];tm2=t[1];break}}}
    if(!tm1&&!tm2){const any=rowBlob.match(/(\d{1,2}[:.]\d{1,2})\s*[-–—]\s*(\d{1,2}[:.]\d{1,2})/);if(any){tm1=normTime(any[1]);tm2=normTime(any[2])}}
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
    let sks=parseInt(String(g('sks')).replace(',','.'),10);if(isNaN(sks))sks=tipeDefault==='Praktikum'?1:2;
    data.push({id:uid(),matkul,kode:g('kode'),sks,hari,tipe:normTipe(g('tipe'),tipeDefault),mulai:tm1,selesai:tm2,kelas:g('kelas'),ruang:g('ruang'),dosen:g('dosen'),prodi:g('prodi')});
    n++;
  }
  return{n,lewat,headerRow:hi};
}

/* ============================================================
   IMPORT EXCEL/CSV
   ============================================================ */
function importExcel(fileId,previewId,dropId,tipeDefault,tipeLabel){
  const f=$(fileId).files[0];
  if(!f)return toast('Pilih file Excel/CSV dulu untuk '+tipeLabel);
  if(typeof XLSX==='undefined'){toast('Pustaka Excel belum termuat — cek internet lalu refresh');return}
  $(previewId).textContent='⏳ Membaca '+f.name+' ...';
  const reset=()=>{try{$(fileId).value=''}catch(_){}clearFile(dropId)};
  const rd=new FileReader();
  rd.onerror=()=>{reset();toast('Gagal membaca file')};
  rd.onload=e=>{
    try{
      let rows=null;
      const isCSV=/\.csv$/i.test(f.name)||String(f.type||'').includes('csv');
      if(isCSV){
        const buf=new Uint8Array(e.target.result);let text='';
        try{text=new TextDecoder('utf-8').decode(buf)}catch(_){text=Array.from(buf).map(b=>String.fromCharCode(b)).join('')}
        rows=parseCSVText(text);
      }else{
        const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
        if(!wb.SheetNames.length)throw new Error('tidak ada sheet di file');
        const ws=wb.Sheets[wb.SheetNames[0]];
        if(!ws||!ws['!ref'])throw new Error('sheet pertama kosong');
        rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true,blankrows:false});
      }
      if(!rows||!rows.length)throw new Error('file kosong / tidak terbaca');
      const r=importRows(rows,tipeDefault);
      reset();save();render();
      $(previewId).textContent='✓ '+r.n+' baris '+tipeLabel+' ditambahkan.'+(r.lewat?' ('+r.lewat+' tanpa nama dilewati)':'')+(r.headerRow>0?' (header baris '+(r.headerRow+1)+')':'');
      toast(r.n?r.n+' jadwal '+tipeLabel+' ditambahkan ✓':'Tidak ada baris valid — cek format kolom');
    }catch(err){
      reset();
      $(previewId).textContent='✗ GAGAL: '+err.message;
      toast('Gagal baca file: '+err.message);
    }
  };
  rd.readAsArrayBuffer(f);
}
$('btnTeori').addEventListener('click',()=>importExcel('fileTeori','previewTeori','dropTeori','Teori','teori'));
$('btnPraktikum').addEventListener('click',()=>importExcel('filePraktikum','previewPraktikum','dropPraktikum','Praktikum','praktikum'));

/* ============================================================
   DRAG & DROP
   ============================================================ */
// store the drop zone <-> file input mapping so the ✕ clear button works
const DROP_MAP = { dropTeori:'fileTeori', dropPraktikum:'filePraktikum' };
function paintDrop(dropId,file){
  const el=$(dropId);if(!el)return;
  if(file){
    el.classList.add('filled');
    el.innerHTML=`<span class="drop-main">📄 <b>${esc(file.name)}</b></span><small>${esc(friendlySize(file.size))} • klik untuk ganti / drag file lain</small><button type="button" class="drop-clear" data-clear="${dropId}" title="Hapus file" aria-label="Hapus file">✕</button>`;
    const clr=el.querySelector('.drop-clear');if(clr)clr.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();clearFile(dropId);});
  }else{
    el.classList.remove('filled');
    // restore the original placeholder label
    const label = dropId==='dropTeori'
      ? '📤 <b>Pilih file Teori</b><small>klik / drag ke sini (XLSX, XLS, CSV)</small>'
      : '📤 <b>Pilih file Praktikum</b><small>klik / drag ke sini (XLSX, XLS, CSV)</small>';
    el.innerHTML=label;
  }
}
function clearFile(dropId){
  const inputId=DROP_MAP[dropId]; if(!inputId)return;
  const inp=$(inputId); try{inp.value=''}catch(_){}
  paintDrop(dropId,null);
  const prevId = dropId==='dropTeori'?'previewTeori':'previewPraktikum';
  const fnId = dropId==='dropTeori'?'fileNameTeori':'fileNamePraktikum';
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
[['fileTeori','previewTeori','dropTeori','fileNameTeori'],['filePraktikum','previewPraktikum','dropPraktikum','fileNamePraktikum']].forEach(([f,p,d,fn])=>{
  $(f).addEventListener('change',()=>{
    const file=$(f).files[0];paintDrop(d,file);
    if(file){
      $(p).textContent='Siap diproses: '+file.name+' — klik tombol Proses.';
      $(fn).textContent=file.name;$(fn).classList.add('ok');
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
      const prev=inputId==='fileTeori'?'previewTeori':'previewPraktikum';
      const fn=inputId==='fileTeori'?'fileNameTeori':'fileNamePraktikum';
      $(prev).textContent='Siap diproses: '+fl[0].name+' — klik tombol Proses.';
      $(fn).textContent=fl[0].name;$(fn).classList.add('ok');
    }
  });
}
armDrop('dropTeori','fileTeori');armDrop('dropPraktikum','filePraktikum');

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
   PWA — register service worker for offline support
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
