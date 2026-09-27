# AM Preset Studio

Pemutar dan editor preset Alight Motion (`.xml`) yang berjalan sepenuhnya di
browser. WebGL2, tanpa server, tanpa unggah, tanpa akun.

Buka `index.html` lewat HTTP lokal atau deploy statis apa pun (repo ini memakai
GitHub Pages). Tidak ada build step, tidak ada dependensi, tidak ada `node_modules`.

## Apa yang dilakukan

- **Parse `.xml` Alight Motion** di browser: layer, group, transform, keyframe,
  easing, media, dan efek. Parser ada di `assets/js/am/parser.js`.
- **Render WebGL2**_scene komposisi_: shape, gambar, video, audio, blend mode,
  dan 31 efek lokal. Lihat bagian [Efek](#efek).
- **Putar timeline** dengan transport, seek, dan loop.
- **Ekspor video** real-time lewat `MediaRecorder` (lihat
  [Known limitation](#known-limitation)).
- **PWA**: manifest, service worker, precache 35 berkas, ikon maskable.
- **Offline penuh** setelah kunjungan pertama.

## Prinsip

Preset `.xml` milik orang lain bisa berisi apa saja. Player resmi mengeksekusi
JavaScript yang tertanam di dalam preset; proyek ini **tidak pernah** menjalankannya.

- Tidak ada `eval`, `new Function`, atau `innerHTML` dari isi preset.
- Tidak ada panggilan jaringan ke pihak ketiga. CSP `connect-src 'self'`
  menegakkan ini di browser, dan `test/imports.mjs` memverifikasinya.
- Parser punya batas keras supaya file raksasa atau bersarang dalam tidak bisa
  menjatuhkan tab:

  | Batas | Nilai |
  | --- | --- |
  | Ukuran XML | 32 MB |
  | Layer | 4000 |
  | Node XML | 400.000 |
  | Keyframe per track | 20.000 |
  | Kedalaman | 32 |

Efek di luar registry **tidak** dibuang diam-diam. Layer tetap digambar, dan
inspector menandai efeknya sebagai belum didukung, sehingga render yang parsial
selalu terlihat sebagai parsial.

## Content-Security-Policy

`index.html` mengirim CSP lewat `<meta>` dengan `default-src 'none'` dan setiap
kemampuan diberikan eksplisit. Tidak ada `unsafe-inline` maupun `unsafe-eval`,
yang berarti markup tidak boleh memuat handler inline, blok `<style>`, atau
atribut `style` — dan memang tidak memuatnya. Delapan atribut `style` yang
pernah ada sudah dipindahkan ke kelas di `assets/css/app.css`.

`frame-ancestors` sengaja tidak ada: direktif itu diabaikan bila dikirim lewat
`<meta>`, dan GitHub Pages tidak bisa mengirim header. Kalau kamu deploy di
backend yang bisa, kirim `frame-ancestors 'none'` sebagai header.

## Efek

Registry lokal di `assets/js/gl/effects.js` memetakan
`com.alightcreative.effects.<nama>` ke uniform shader. Registry ini menutup
**21 dari 21** tipe efek pada satu ekspor AM nyata (175 instans). Yang belum
terdaftar, seperti `neonGlowUltra`, tampil apa adanya di inspector.

Dua detail format AM yang mudah salah dan sudah ditangani:

- Namespace tidak konsisten. Sebagian besar id berbentuk
  `com.alightcreative.effects.<nama>`, tapi ada juga
  `com.alightcreative.<nama>` tanpa segmen `effects`. Keduanya dinormalkan.
- Directional blur muncul sebagai `dblur` maupun `dbur`; keduanya dipetakan ke
  entri yang sama.

Helper `isKnownFx`, `fxLabel`, `fxTint`, dan `fxGroupTint` menerima nama pendek
maupun id lengkap, supaya pemanggil tidak bisa salah lookup dan diam-diam
menyimpulkan semua efek "tidak didukung".

## Test

Tidak butuh dependensi, hanya Node (diuji di v20):

```sh
node test/all.mjs

# dengan ekspor AM nyata sebagai fixture tambahan
AM_REF_XML=/path/to/export.xml node test/all.mjs
```

Empat suite:

| Suite | Isi |
| --- | --- |
| syntax | 30 modul terparse sebagai ESM |
| `test/run.mjs` | parser, easing, track sampling, batas, keamanan |
| `test/imports.mjs` | graf import, ekspor, precache, CSP, markup |
| `test/boot.mjs` | boot `main.js` sungguhan, WebGL compositor, player, audio |

Tanpa `AM_REF_XML`, grup yang bergantung pada ekspor nyata dilewati dan preset
demo bawaan digunakan sebagai pengganti — bukan diam-diam dianggap lulus.
Simpan berkasmu di `test/fixtures/` agar grup itu ikut jalan.

`test/paths.mjs` menyalin app ke direktori sementara dengan
`package.json` `{"type":"module"}`, karena situs ini sengaja tidak punya
`package.json` dan `node --check` akan salah memperlakukan `.js` sebagai
CommonJS.

## Known limitation

- **Ekspor** hanya `MediaRecorder` real-time. Encoding offline yang frame-exact
  lewat WebCodecs belum diimplementasikan. Tidak ada kode yang mengimpor
  mediabunny; jangan menyebutnya bekerja.
- **Bukan pixel-perfect.** Ini renderer perkiraan, bukan reimplementasi Alight
  Motion. Beberapa efek punya uniform yang kasar, dan blend mode tertentu
  disederhanakan.
- **`frame-ancestors`** tidak bisa ditegakkan dari `<meta>` (lihat di atas).
- Test berjalan di Node dengan stub browser, bukan browser sungguhan. Yang
  terverifikasi: logika boot, jalur impor, parser, dan komposisi uniforms. Yang
  belum: pixel WebGL asli, dialog OS, playback media nyata, dan encoder.

## Struktur

```
index.html              shell, CSP, sprite SVG
manifest.webmanifest    PWA manifest
sw.js                   entry point service worker (module)
assets/css/app.css      seluruh gaya
assets/js/
  am/                   parser .xml + easing
  core/                 state, bus, db, player, audio, log, toast, theme, SW
  gl/                   shader, renderer, media, scene compositing, effects
  ui/                   tab, stage, layers, media, export, settings, keyboard
  workers/xmlWorker.js  parsing di luar thread utama
test/                   harness (Node, tanpa dependensi)
tools/make-demo.py      membuat ulang assets/data/demo.json
```

Presets dan media disimpan lokal di IndexedDB (`core/db.js`); tidak ada yang
keluar dari perangkat.

## Lisensi

Kode ini milik repositori ini. Berkas preset belonging to their respective
owners tidak disertakan.
