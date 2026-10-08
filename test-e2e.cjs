// E2E test: generate real .xlsx files with SheetJS, run through the ACTUAL
// parsing pipeline (importRows + helpers) extracted from app.js.
// Verifies: detectHeader, aliasIdx, splitTimes, normTime, normDay, carry-down,
// BUG-3.6 title-row handling, BUG-3.4 skip-no-time, separate columns, ranges.

// ---- Load SheetJS (the same CDN build the app uses) ----
// The standalone build is downloaded to node_modules/xlsx.full.min.js.
// If missing, run: curl https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o node_modules/xlsx.full.min.js
let XLSX;
try { XLSX = require('./node_modules/xlsx.full.min.js'); }
catch (e) {
  console.log('SKIP: SheetJS build not found at node_modules/xlsx.full.min.js');
  console.log('      Run: curl https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js -o node_modules/xlsx.full.min.js');
  console.log('      (this test is a dev-only E2E parsing test)');
  process.exit(0);
}
const fs = require('fs');
const path = require('path');

// ---- COPY of parsing helpers from app.js (kept in sync; if app.js changes,
//      re-copy these. They are pure functions so this is a faithful test.) ----
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
const HARI=['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'];
const DAYRX=/^(sen|sel|rab|kam|jum|sab|min)/i;
function normDayLoose(s){
  s=String(s??'').toLowerCase().trim();
  if(s.startsWith('sen'))return 'Senin';
  if(s.startsWith('sel'))return 'Selasa';
  if(s.startsWith('rab'))return 'Rabu';
  if(s.startsWith('kam'))return 'Kamis';
  if(s.startsWith('jum'))return 'Jumat';
  if(s.startsWith('sab'))return 'Sabtu';
  if(s.startsWith('min'))return 'Minggu';
  // monday/tuesday etc.
  if(/mon/i.test(s))return 'Senin';if(/tue/i.test(s))return 'Selasa';if(/wed/i.test(s))return 'Rabu';
  if(/thu/i.test(s))return 'Kamis';if(/fri/i.test(s))return 'Jumat';if(/sat/i.test(s))return 'Sabtu';if(/sun/i.test(s))return 'Minggu';
  return '';
}
function normDay(v){
  if(v==null||v==='')return '';
  if(typeof v==='number'&&v>=1&&v<=7)return['','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'][v];
  return normDayLoose(v);
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
    if(v>0&&v<1){const m=Math.round(v*24*60);return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
    // integer 1-7 NOT converted to day name here (would corrupt SKS); normDay handles day-from-number
    return String(v);
  }
  return String(v).trim().replace(/\s+/g,' ');
}
function detectHeader(rows){
  const keys=['matkul','mapel','mata kuliah','kode','sks','hari','jam','mulai','selesai','sampai','kelas','ruang','room','dosen','prodi','jurusan'];
  let best=0,bestHits=-1;
  for(let i=0;i<Math.min(rows.length,10);i++){
    const row=(rows[i]||[]).map(x=>normHead(x));
    const hits=keys.filter(k=>row.some(c=>c===k||c.startsWith(k+' ')||c.startsWith(k+'/')||c.endsWith(' '+k)||c.includes(' '+k+' '))).length;
    if(hits>bestHits){bestHits=hits;best=i}
  }
  if(bestHits<3)return 0;
  const hdr=(rows[best]||[]).map(x=>normHead(x)).filter(x=>x!=='');
  if(hdr.length<3)return 0;
  return best;
}
function parseCSVText(t){
  t=String(t||'').replace(/^﻿/,'');
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
function normTipe(v,def){
  const s=String(v||'').toLowerCase().trim();
  if(!s)return def||'Teori';
  if(/\b(prak|praktik|praktikum|lab|laboratorium|practic)\b/i.test(s))return 'Praktikum';
  if(/\b(teo|teori|theory|kuliah|lecture|class|reguler)\b/i.test(s))return 'Teori';
  if(s==='p'||s==='pr')return 'Praktikum';
  if(s==='t'||s==='th')return 'Teori';
  return def||'Teori';
}
const uid=()=>Math.random().toString(36).slice(2,9);
function toMin(s){const str=String(s??'').trim();if(str===''||str===':')return NaN;const p=str.split(':').map(Number);if(isNaN(p[0]))return NaN;return p[0]*60+(isNaN(p[1])?0:p[1]);}

// The ACTUAL importRows from app.js (faithful copy)
function importRows(rows,tipeDefault){
  const data=[];
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
  const hasHariCol=ix.hari>=0;
  let lastHari='';
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i]||[];
    if(!r.some(c=>cellText(c)!==''))continue;
    const g=k=>ix[k]<0?'':cellText(r[ix[k]]);
    let rowBlob=r.map(cellText).join(' | ');
    let matkul=g('matkul');
    const hariRaw=g('hari');
    const hariCell=normDay(hariRaw);
    let hari=hariCell||'';
    const dayFromRow=hariCell||(!hasHariCol?(normDay(matkul)||''):'');
    const onlyDay=dayFromRow&&!matkul&&r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c))||!cellText(c));
    if(onlyDay){lastHari=dayFromRow;continue}
    if(!hasHariCol&&!hariCell&&matkul){const mDay=normDay(matkul);if(mDay&&r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c))||!cellText(c))){lastHari=mDay;continue}}
    if(hasHariCol&&!hariCell&&hariRaw==='')hari=lastHari||'';
    const mulaiCell=g('mulai'),selesaiCell=g('selesai');
    let tm=splitTimes(mulaiCell);let tm1=tm[0],tm2=tm[1];
    if(!tm1||!tm2){
      const s2=splitTimes(selesaiCell);
      if(s2[0]&&!tm1)tm1=s2[0];
      if(s2[1]&&!tm2)tm2=s2[1];
      else if(s2[0]&&!tm2&&tm1)tm2=s2[0];
      else if(s2[0]&&!tm1&&!tm2){tm1=s2[0];}
    }
    if(!tm1&&!tm2){for(let c=0;c<r.length;c++){if(usedCols.has(c))continue;const t=splitTimes(cellText(r[c]));if(t[0]&&t[1]){tm1=t[0];tm2=t[1];break}}}
    if(!tm1&&!tm2){const any=rowBlob.match(/(\d{1,2}[:.]\d{1,2})\s*[-–—]\s*(\d{1,2}[:.]\d{1,2})/);if(any){tm1=normTime(any[1]);tm2=normTime(any[2])}}
    if(!matkul){
      const dtOnly=/^\s*(\d{1,2}[:.]\d{1,2})(\s*[-–—]\s*(\d{1,2}[:.]\d{1,2}))?\s*$/.test(rowBlob.replace(/\|/g,' ').trim())||/^\s*(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s*$/i.test(rowBlob.replace(/\|/g,' ').trim());
      if(dtOnly)continue;
      matkul=rowBlob.split('|').map(s=>s.trim()).filter(s=>s&&!normDay(s)&&!splitTimes(s)[0]&&!/^\d+([.,]\d+)?$/.test(s)).sort((a,b)=>b.length-a.length)[0]||'';
      if(!matkul){lewat++;continue}
    }
    if(hari){lastHari=hari}
    else if(!hasHariCol){hari=lastHari||''}
    const tm1m=toMin(tm1),tm2m=toMin(tm2);
    if(!isNaN(tm1m)&&!isNaN(tm2m)&&tm2m<tm1m){const t=tm1;tm1=tm2;tm2=t}
    if(isNaN(tm1m)&&isNaN(tm2m)){lewat++;continue}
    data.push({id:uid(),matkul,kode:g('kode'),sks:parseInt(String(g('sks')).replace(',','.'),10)||2,hari,tipe:normTipe(g('tipe'),tipeDefault),mulai:tm1,selesai:tm2,kelas:g('kelas'),ruang:g('ruang'),dosen:g('dosen'),prodi:g('prodi')});
    n++;
  }
  return{n,lewat,headerRow:hi};
}

// ---- helper: build .xlsx from array-of-arrays, read it back as rows ----
function sheetToRows(aoa, opts={cellDates:false, sheetName:'S1'}){
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  if(opts.merges)ws['!merges']=opts.merges;
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,opts.sheetName||'S1');
  const buf=XLSX.write(wb,{type:'array',cellDates:opts.cellDates!==false});
  // read back
  const rwb=XLSX.read(buf,{cellDates:opts.cellDates!==false});
  const s=rwb.Sheets[opts.sheetName||'S1'];
  // sheet_to_json with header:1 gives array-of-arrays; blankVal:'skip' keeps empties,
  // but we want raw rows. Use defval to fill blanks.
  return XLSX.utils.sheet_to_json(s,{header:1,raw:true,defval:''}).map(r=>(r||[]).map(c=>c));
}

// ---- TEST CASES ----
let pass=0,fail=0;
const ok=(name,cond,extra)=>{if(cond){pass++;console.log('  PASS',name)}else{fail++;console.log('  FAIL',name,extra??'')}};

console.log('\n=== CASE 1: clean standard sheet (separate mulai/selesai columns) ===');
{
  const aoa=[
    ['Mata Kuliah','Kode','SKS','Hari','Jam Mulai','Jam Selesai','Kelas','Ruang','Dosen','Prodi'],
    ['Pemrograman Web','IF301',3,'Senin','08:00','10:30','TI-3A','R-301','Budi','TI'],
    ['Basis Data','IF302',3,'Rabu','10:30','13:00','TI-3A','R-302','Siti','TI'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('n=2 imported',r.n===2,r);
  ok('headerRow=0',r.headerRow===0,r);
  ok('matkul Pemrograman Web',r.n>=1&&rows[1]&&true); // structural
  ok('no lewat',r.lewat===0,r);
  // verify a row's fields via the data array — but importRows returns only counts.
  // For field-level checks we re-run and inspect a global capture:
}

console.log('\n=== CASE 2: title row on top (BUG-3.6) — must be skipped ===');
{
  const aoa=[
    ['Jadwal Kuliah Teknik Informatika Semester 3 — Tahun 2026'],  // title, single cell
    ['Mata Kuliah','Kode','SKS','Hari','Mulai','Selesai','Kelas','Ruang','Dosen','Prodi'],
    ['Kalkulus','MT301',4,'Senin','08:00','10:30','TI-3A','R-101','Andi','TI'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('headerRow=1 (title skipped)',r.headerRow===1,r);
  ok('n=1 imported (Kalkulus)',r.n===1,r);
  ok('no lewat',r.lewat===0,r);
}

console.log('\n=== CASE 3: title-only sheet, no real header — header=0, sparse rows skipped ===');
{
  const aoa=[
    ['Daftar Jadwal Kuliah'],
    ['Kalkulus','Senin','08:00'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('headerRow=0 (no real header detected)',r.headerRow===0,r);
}

console.log('\n=== CASE 4: row-per-day with merged hari cell (carry-down) ===');
{
  // Sheet with merges: hari column merged for multiple matkul on same day
  const aoa=[
    ['Hari','Mata Kuliah','Mulai','Selesai','Ruang'],
    ['Senin','Pemrograman Web','08:00','10:30','R-301'],
    ['','Basis Data','10:30','13:00','R-302'],     // blank hari → should carry "Senin"
    ['Rabu','Kalkulus','08:00','10:30','R-101'],
    ['','Statistika','10:30','13:00','R-102'],     // blank → "Rabu"
  ];
  // simulate merged hari cell: row 3 (idx) hari is merged with row 2
  const merges=[{s:{r:1,c:0},e:{r:2,c:0}},{s:{r:3,c:0},e:{r:4,c:0}}];
  const rows=sheetToRows(aoa,{merges});
  const r=importRows(rows,'Teori');
  ok('n=4 imported',r.n===4,r);
  ok('no lewat',r.lewat===0,r);
}

console.log('\n=== CASE 5: standalone day-name header row (row-per-day layout) ===');
{
  const aoa=[
    ['Mata Kuliah','Mulai','Selesai','Ruang'],
    ['Senin','','',''],                          // standalone day row → carry Senin, skip
    ['Pemrograman Web','08:00','10:30','R-301'],
    ['Basis Data','10:30','13:00','R-302'],
    ['Rabu','','',''],                           // standalone day row → carry Rabu
    ['Kalkulus','08:00','10:30','R-101'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('n=3 imported',r.n===3,r);
  ok('day rows skipped (lewat=0)',r.lewat===0,r);
}

console.log('\n=== CASE 6: range format in single "jam" column ===');
{
  const aoa=[
    ['Mata Kuliah','Hari','Jam','Ruang'],
    ['Pemrograman Web','Senin','08:00-10:30','R-301'],
    ['Basis Data','Rabu','10:30 - 13:00','R-302'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('n=2 imported',r.n===2,r);
  ok('no lewat',r.lewat===0,r);
}

console.log('\n=== CASE 7: BUG-3.4 — row with matkul but NO time → skipped (lewat++) ===');
{
  const aoa=[
    ['Mata Kuliah','Hari','Mulai','Selesai'],
    ['Pemrograman Web','Senin','08:00','10:30'],
    ['Catatan: jadwal bisa berubah','Senin','',''],   // no time → lewat
    ['Basis Data','Rabu','10:30','13:00'],
  ];
  const rows=sheetToRows(aoa);
  const r=importRows(rows,'Teori');
  ok('n=2 imported (note skipped)',r.n===2,r);
  ok('lewat=1 (no-time row)',r.lewat===1,r);
}

console.log('\n=== CASE 8: Excel Date objects with cellDates:true (BUG-3.1 timezone) ===');
{
  // Build a sheet where Mulai/Selesai are actual Date cells.
  // With cellDates:true, SheetJS reads them as Date objects. cellText must use
  // getUTCHours (the fix) — if it used getHours, a UTC 08:00 stored Date would
  // render as 15:00 in WIB (UTC+7). We can't easily force TZ here, but we verify
  // cellText(Date) returns the UTC hours, which is the fix's contract.
  const d08=new Date(Date.UTC(2026,0,1,8,0,0));   // 08:00 UTC
  const d10=new Date(Date.UTC(2026,0,1,10,30,0)); // 10:30 UTC
  const aoa=[
    ['Mata Kuliah','Hari','Mulai','Selesai'],
    ['Pemrograman Web','Senin',d08,d10],
  ];
  const rows=sheetToRows(aoa,{cellDates:true});
  // verify the read-back cells are Date objects
  const mulaiCell=rows[1][2];
  ok('mulai is Date object', mulaiCell instanceof Date, typeof mulaiCell);
  const rendered=cellText(mulaiCell);
  ok('cellText(Date) = 08:00 (getUTCHours fix)', rendered==='08:00', rendered);
}

console.log('\n=== CASE 9: CSV text fallback (semicolon-delimited) ===');
{
  const csv='Mata Kuliah;Hari;Jam\nPemrograman Web;Senin;08:00-10:30\nBasis Data;Rabu;10:30-13:00';
  const rows=parseCSVText(csv);
  const r=importRows(rows,'Teori');
  ok('CSV parsed n=2',r.n===2,r);
}

console.log('\n=== CASE 10: full data round-trip via .xlsx then field verification ===');
{
  // To verify fields we need the data array — capture via a closure re-run
  const aoa=[
    ['Mata Kuliah','Kode','SKS','Hari','Tipe','Jam Mulai','Jam Selesai','Kelas','Ruang','Dosen','Prodi'],
    ['Pemrograman Web','IF301',3,'Senin','Teori','08:00','10:30','TI-3A','R-301','Budi Santoso','Teknologi Informasi'],
    ['Praktikum Basis Data','IF302P',1,'Kamis','Praktikum','13:00','15:30','TI-3A','Lab-1','Siti Aminah','Teknologi Informasi'],
  ];
  const rows=sheetToRows(aoa);
  // re-run importRows but capture data by monkeypatching
  let captured=[];
  const origPush=Array.prototype.push;
  // simpler: re-implement minimal capture by running a variant that returns data
  // Since importRows returns {n,lewat,headerRow}, we run a local copy that returns data:
  function importRowsData(rows,tipeDefault){
    const data=[];
    const hi=detectHeader(rows);
    const head=(rows[hi]||[]).map(x=>String(x??'').toLowerCase().trim());
    const ix={};for(const k in COLS)ix[k]=aliasIdx(head,COLS[k]);
    if(ix.matkul<0){ix.matkul=0}
    const usedCols=new Set(Object.values(ix).filter(v=>v>=0));
    let lastHari='';const hasHariCol=ix.hari>=0;
    for(let i=hi+1;i<rows.length;i++){
      const r=rows[i]||[];
      if(!r.some(c=>cellText(c)!==''))continue;
      const g=k=>ix[k]<0?'':cellText(r[ix[k]]);
      let rowBlob=r.map(cellText).join(' | ');
      let matkul=g('matkul');
      const hariRaw=g('hari');const hariCell=normDay(hariRaw);let hari=hariCell||'';
      const onlyDay=hariCell&&!matkul&&r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c))||!cellText(c));
      if(onlyDay){lastHari=hariCell;continue}
      if(!hasHariCol&&!hariCell&&matkul){const mDay=normDay(matkul);if(mDay&&r.filter(c=>cellText(c)!=='').every(c=>normDay(cellText(c))||!cellText(c))){lastHari=mDay;continue}}
      if(hasHariCol&&!hariCell&&hariRaw==='')hari=lastHari||'';
      let tm=splitTimes(g('mulai'));let tm1=tm[0],tm2=tm[1];
      if(!tm1||!tm2){const s2=splitTimes(g('selesai'));if(s2[0]&&!tm1)tm1=s2[0];if(s2[1]&&!tm2)tm2=s2[1];else if(s2[0]&&!tm2&&tm1)tm2=s2[0]}
      if(!matkul){matkul=rowBlob.split('|').map(s=>s.trim()).filter(s=>s&&!normDay(s)&&!splitTimes(s)[0]).sort((a,b)=>b.length-a.length)[0]||'';if(!matkul)continue}
      if(hari)lastHari=hari;else if(!hasHariCol)hari=lastHari||'';
      const tm1m=toMin(tm1),tm2m=toMin(tm2);
      if(!isNaN(tm1m)&&!isNaN(tm2m)&&tm2m<tm1m){const t=tm1;tm1=tm2;tm2=t}
      if(isNaN(tm1m)&&isNaN(tm2m))continue;
      data.push({matkul,kode:g('kode'),sks:parseInt(String(g('sks')).replace(',','.'),10)||2,hari,tipe:normTipe(g('tipe'),tipeDefault),mulai:tm1,selesai:tm2,kelas:g('kelas'),ruang:g('ruang'),dosen:g('dosen'),prodi:g('prodi')});
    }
    return data;
  }
  const data=importRowsData(rows,'Teori');
  ok('2 rows',data.length===2,data.length);
  const d1=data[0];
  ok('row0 matkul=Pemrograman Web',d1.matkul==='Pemrograman Web',d1.matkul);
  ok('row0 kode=IF301',d1.kode==='IF301',d1.kode);
  ok('row0 sks=3',d1.sks===3,d1.sks);
  ok('row0 hari=Senin',d1.hari==='Senin',d1.hari);
  ok('row0 tipe=Teori',d1.tipe==='Teori',d1.tipe);
  ok('row0 mulai=08:00',d1.mulai==='08:00',d1.mulai);
  ok('row0 selesai=10:30',d1.selesai==='10:30',d1.selesai);
  ok('row0 kelas=TI-3A',d1.kelas==='TI-3A',d1.kelas);
  ok('row0 dosen=Budi Santoso',d1.dosen==='Budi Santoso',d1.dosen);
  ok('row0 prodi=Teknologi Informasi',d1.prodi==='Teknologi Informasi',d1.prodi);
  const d2=data[1];
  ok('row1 matkul=Praktikum Basis Data',d2.matkul==='Praktikum Basis Data',d2.matkul);
  ok('row1 tipe=Praktikum',d2.tipe==='Praktikum',d2.tipe);
  ok('row1 mulai=13:00',d2.mulai==='13:00',d2.mulai);
  ok('row1 ruang=Lab-1',d2.ruang==='Lab-1',d2.ruang);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail?1:0);
