# Noisy TeraBox Downloader

Website downloader TeraBox gratis dengan backend Node.js (Express) yang membungkus scraper flowvideoplayer.com, dan frontend dark-theme dengan background video 3D animasi.

## Menjalankan

```bash
npm install
npm start
```

Buka **http://localhost:3000**

## Struktur

- `server.js` - Express server + endpoint `POST /api/download` (body: `{ "url": "https://1024terabox.com/s/..." }`)
- `public/` - frontend statis (HTML/CSS/JS vanilla, tanpa build step)

## Catatan

- Validasi URL di server menerima semua domain berbagi TeraBox (terabox.com, 1024terabox.com, 4funbox, mirrobox, nephobox, dll).
- Font di-self-host via `@fontsource` (Space Grotesk + JetBrains Mono).
- Menghormati `prefers-reduced-motion` (video background & animasi dimatikan) dan `prefers-reduced-transparency` (glass panel jadi solid).
- Scraper engine oleh Noisy
