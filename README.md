<div align="center">

# Noisy TeraBox Downloader

**Unduh file TeraBox gratis, cepat, tanpa login — langsung di browser.**

Website downloader TeraBox dengan backend Node.js (Express) yang membungkus scraper flowvideoplayer.com + API web-share resmi TeraBox, dan frontend dark-theme glassmorphism dengan background video 3D animasi, preloader, dan asisten AI.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20JS-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![License](https://img.shields.io/badge/Lisensi-Personal%20Use-8A2BE2?style=flat-square)

</div>

---

## ✨ Fitur

| Platform | Kemampuan |
|---|---|
| **TeraBox** (semua domain cerminan) | Video: unduh + stream HLS · Foto: unduh · File lain: unduh · Folder: ditelusuri otomatis |

**Fitur umum:**

- 🎨 Dark glassmorphism UI dengan background video 3D, preloader animasi kotak unduhan, dan scroll reveal yang ringan
- ⚡ Dua jalur scraper paralel: upstream flowvideoplayer (video + dlink cepat) dan API web-share resmi TeraBox (isi folder lengkap) — satu gagal, yang lain tetap jalan
- 📁 Folder ditelusuri otomatis (BFS sampai 30 folder / 500 file), termasuk subfolder
- 🎬 Stream video langsung di browser via HLS (proxy playlist + segmen, tanpa masalah CORS)
- 🗜️ **Unduh Semua** — semua file yang bisa diambil dikemas menjadi satu ZIP dengan unduhan paralel + auto-resume
- 🔓 Video "Terkunci" bisa dibuka dengan cookie sesi login (tersimpan hanya di localStorage browser Anda)
- 🤖 Asisten AI mengambang yang menjawab pertanyaan seputar situs
- 📱 Mobile responsive + `prefers-reduced-motion` dihormati
- 📄 Halaman Kebijakan Privasi & Ketentuan Layanan

---

## 🚀 Menjalankan Secara Lokal

> [!IMPORTANT]
> Butuh **Node.js 18+**

```bash
git clone https://github.com/cokguss/noisyteraboxdownloader.git
cd noisyteraboxdownloader
npm install
npm start
```

Buka **http://localhost:3000**

| Script | Fungsi |
|---|---|
| `npm start` | Menjalankan server di port `3000` (atur lewat env `PORT`) |

---

## 🧠 Cara Kerja

```text
┌─────────┐  link TeraBox   ┌──────────────────────────────────────────┐
│ Browser  │ ──────────────▶ │ Express (server.js)                      │
└─────────┘                 │                                          │
      ▲                     │  1. openSession()        → flowvideoplayer
      │                     │  2. scrapeTerabox()      → video + dlink
      │  unduh / stream     │  3. scrapeTeraBoxShare() → isi folder
      └─────────────────────│     (API web-share resmi, BFS folder)    │
                            │  4. merge + dedupe per nama file         │
                            └──────────────────────────────────────────┘
```

- **Jalur video (flowvideoplayer):** menyuplai dlink unduh cepat + URL stream HLS untuk video.
- **Jalur share resmi (TeraBox):** `shorturlinfo` + `share/list` menampilkan seluruh isi folder; video yang tidak disuplai jalur pertama tetap tampil dengan penanda "Terkunci", dan bisa dibuka lewat cookie sesi login milik user.
- **ZIP (`/api/zip`):** unduh paralel 8 koneksi, cek `Content-Length` via `Range: bytes=0-0`, auto-resume bila CDN memutus koneksi di tengah jalan.
- **Stream HLS (`/api/stream`):** playlist ditulis ulang agar semua segmen lewat proxy — menghindari tembok CORS CDN.

---

## 📁 Struktur Proyek

```text
noisyteraboxdownloader/
├─ server.js              # Express API: /api/download, /api/zip, /api/file, /api/stream
├─ public/
│  ├─ index.html          # halaman utama (single page)
│  ├─ css/style.css       # seluruh styling (tema emerald + zinc-950)
│  ├─ js/
│  │  ├─ app.js           # logika frontend (form, hasil, modal, reveal)
│  │  ├─ loader.js        # preloader
│  │  └─ chat.js          # asisten AI mengambang
│  └─ img/                # logo, favicon, foto developer
└─ package.json
```

---

## ☁️ Deploy

| Kebutuhan | Penjelasan |
|---|---|
| Node.js runtime | Server Express harus hidup — start command `npm start` |
| Port | Dibaca dari env `PORT` (default `3000`) |

1. Push repo ini ke GitHub.
2. Import repo di Vercel / Railway / Render / VPS pilihan Anda.
3. Pastikan start command `npm start`, lalu deploy.

> [!NOTE]
> Endpoint upstream bisa berubah sewaktu-waktu karena bergantung pada flowvideoplayer dan TeraBox.

---

## ⚠️ Catatan

- © 2026 Noisy. Scraper engine oleh **Noisy**.
- Bukan produk resmi TeraBox. Gunakan hanya pada file yang Anda miliki haknya — lihat [LICENSE.md](LICENSE.md).
- Link unduhan (dlink) berlaku beberapa jam; ambil ulang bila kedaluwarsa.
- Cookie sesi yang Anda tempel hanya tersimpan di browser Anda sendiri.

---

<div align="center">

**Dibuat dengan 💚 — Noisy**

[Telegram](https://t.me/noisy02) · [GitHub](https://github.com/cokguss)

</div>
