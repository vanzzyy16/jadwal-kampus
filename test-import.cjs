// Regression tests for the IMPORT pipeline.
//
// Unlike test-e2e.cjs (which keeps its own copies of the helpers), this suite
// loads the REAL app.js through harness.cjs, so it fails if app.js breaks even
// when the copies in test-e2e.cjs are stale.
//
// Every case below is a bug that was actually observed, not a hypothetical:
//   R1  headerless file silently lost its first data row
//   R2  headerless file + separate start/end time columns imported NOTHING
//   R3  day name packed into a cell ("Senin, 08:00-10:30") was dropped
//   R4  numeric day column (Excel 1-7) produced blank days
//   R5  teori/praktikum was not auto-detected without a tipe column
//   R6  only the first sheet of a workbook was read
//   R7  anti-duplicate key used the filename, so a renamed file re-imported
//
// Run: node test-import.cjs
const { probe } = require('./harness.cjs');
const { importRows, readFileRows, detectHeader, hashBytes, inferTipe, normDay, dayInCell } = probe;

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL: ' + label)); return cond; };
const eq = (a, b, label) => ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')');
const head = (s) => console.log('\n=== ' + s + ' ===');

function imp(rows, def) { const t = []; const r = importRows(rows, def || 'Teori', t); return { r, t }; }

// ---------------------------------------------------------------- R1
head('R1 headerless file keeps EVERY row (row 0 used to be eaten)');
{
  const rows = [
    ['Pemrograman Web', 'IF301', '3', 'Senin', '08:00-10:30'],
    ['Basis Data', 'IF302', '3', 'Selasa', '10:30-13:00'],
    ['Algoritma', 'IF303', '3', 'Rabu', '08:00-10:30'],
  ];
  eq(detectHeader(rows), -1, 'detectHeader reports "no header" as -1, not 0');
  const { r, t } = imp(rows);
  eq(r.n, 3, 'all 3 rows imported');
  eq(t[0].matkul, 'Pemrograman Web', 'first row survived');
  eq(r.lewat, 0, 'nothing skipped');
}

// ---------------------------------------------------------------- R2
head('R2 headerless + SEPARATE start/end time columns imports');
{
  const { r, t } = imp([
    ['Pemrograman Web', 'IF301', '3', 'Senin', '08:00', '10:30', 'R-301'],
    ['Basis Data', 'IF302', '3', 'Selasa', '10:30', '13:00', 'R-302'],
  ]);
  eq(r.n, 2, 'both rows imported (was 0 before the fix)');
  eq(t[0].mulai, '08:00', 'start time read');
  eq(t[0].selesai, '10:30', 'end time read');
  eq(t[1].selesai, '13:00', 'second row end time read');
  eq(t[0].ruang, '', 'SKS 3 was not mistaken for a clock time');
}

// ---------------------------------------------------------------- R3
head('R3 day name packed inside a cell is recovered');
{
  const { r, t } = imp([
    ['Mata Kuliah', 'Jadwal', 'Ruang'],
    ['Sistem Operasi', 'Senin, 08:00-10:30', 'R-306'],
    ['Praktikum Sistem Operasi', 'Rabu, 13:00-15:30', 'Lab-4'],
  ]);
  eq(r.n, 2, 'both rows imported');
  eq(t[0].hari, 'Senin', 'Senin recovered from "Senin, 08:00-10:30"');
  eq(t[1].hari, 'Rabu', 'Rabu recovered');
  eq(t[1].ruang, 'Lab-4', 'other columns still read');
}

// ---------------------------------------------------------------- R4
head('R4 numeric day column (1-7) maps to day names');
{
  eq(normDay(1), 'Senin', 'normDay(1)');
  eq(normDay('3'), 'Rabu', 'normDay("3") — cellText stringifies numbers');
  eq(normDay(7), 'Minggu', 'normDay(7)');
  const { t } = imp([
    ['Mata Kuliah', 'Hari', 'Jam'],
    ['Statistika', 1, '08:00-10:30'],
    ['Praktikum Statistika', 3, '13:00-15:30'],
  ]);
  eq(t[0].hari, 'Senin', 'numeric day 1 -> Senin');
  eq(t[1].hari, 'Rabu', 'numeric day 3 -> Rabu');
}

// ---------------------------------------------------------------- R5
head('R5 teori/praktikum auto-detected without a tipe column');
{
  const { t } = imp([
    ['Mata Kuliah', 'Kode', 'SKS', 'Hari', 'Jam'],
    ['Pemrograman Web', 'IF301', '3', 'Senin', '08:00-10:30'],
    ['Praktikum Pemrograman Web', 'IF301P', '1', 'Selasa', '13:00-15:30'],
    ['Basis Data', 'IF302', '3', 'Rabu', '10:30-13:00'],
    ['Kolaborasi Digital', 'IF400', '2', 'Kamis', '08:00-10:30'],
  ]);
  eq(t[0].tipe, 'Teori', 'plain name -> Teori');
  eq(t[1].tipe, 'Praktikum', '"Praktikum" in the name -> Praktikum');
  eq(t[2].tipe, 'Teori', 'no marker -> Teori');
  eq(t[3].tipe, 'Teori', '"Kolaborasi" is NOT matched by the lab keyword');
  eq(t[0].sks, 3, 'SKS read from column');
  eq(t[1].sks, 1, 'SKS read from column');

  // code suffix, and explicit tipe column always wins
  eq(inferTipe('Basis Data', 'IF301P'), 'Praktikum', 'code suffix P');
  eq(inferTipe('Algoritma', 'IF303-P'), 'Praktikum', 'code suffix -P');
  eq(inferTipe('Algoritma', 'IF303.T'), 'Teori', 'code suffix .T');
  eq(inferTipe('Algoritma', 'IF303'), '', 'unmarked code -> undecided');
  const { t: t2 } = imp([
    ['Mata Kuliah', 'Kode', 'Hari', 'Tipe', 'Jam'],
    ['Praktikum Web Lanjut', 'IF301P', 'Senin', 'Teori', '08:00-10:30'],
  ]);
  eq(t2[0].tipe, 'Teori', 'explicit tipe column overrides name/code inference');
}

// ---------------------------------------------------------------- R6
head('R6 every sheet of a workbook is read');
{
  const XLSX = require('./node_modules/xlsx.full.min.js');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Mata Kuliah', 'Kode', 'Hari', 'Jam', 'Ruang'],
    ['Algoritma', 'IF303', 'Senin', '08:00-10:30', 'R-303'],
  ]), 'Teori');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Mata Kuliah', 'Kode', 'Hari', 'Jam', 'Ruang'],
    ['Praktikum Algoritma', 'IF303P', 'Jumat', '08:00-10:30', 'Lab-3'],
  ]), 'Praktikum');
  const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const file = { name: 'dua-sheet.xlsx', type: '', size: buf.length, lastModified: 1, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };

  readFileRows(file).then((res) => {
    eq(res.sheets.length, 2, 'both sheets returned');
    const all = [];
    for (const s of res.sheets) importRows(s, 'Teori', all);
    eq(all.length, 2, 'rows from both sheets imported');
    eq(all[1].tipe, 'Praktikum', 'praktikum sheet classified correctly');
    finish();
  }).catch((e) => { fail++; console.log('  FAIL: R6 threw ' + e.message); finish(); });
}

function finish() {
  // ------------------------------------------------------------- R7
  head('R7 anti-duplicate key is the file CONTENT, not the name');
  const same = Buffer.from('Mata Kuliah,Kode,Hari,Jam\nFoo,IF999,Senin,08:00-10:30');
  const other = Buffer.from('Mata Kuliah,Kode,Hari,Jam\nBar,IF998,Selasa,10:30-13:00');
  const f = (name, b) => ({ name, type: 'text/csv', size: b.length, lastModified: 1, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  Promise.all([
    readFileRows(f('a.csv', same)),
    readFileRows(f('RENAMED.csv', same)),
    readFileRows(f('a.csv', other)),
  ]).then(([k1, k2, k3]) => {
    eq(k1.key, k2.key, 'same bytes under a different filename -> same key');
    ok(k1.key !== k3.key, 'different bytes under the SAME filename -> different key');
    eq(typeof hashBytes(new Uint8Array([1, 2, 3])), 'string', 'hashBytes returns a string');

    console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===');
    process.exit(fail ? 1 : 0);
  }).catch((e) => { console.log('  FAIL: R7 threw ' + e.message); console.log('\n=== RESULT: ' + pass + ' passed, ' + (fail + 1) + ' failed ==='); process.exit(1); });
}