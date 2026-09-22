/**
 * Noisy TeraBox Downloader - server
 * Express backend yang membungkus scraper flowvideoplayer.com
 * sebagai REST API untuk frontend.
 */

const path = require('path');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

/*
 * Static assets dikirim dengan `Cache-Control: no-cache` (revalidate tiap
 * load; browser dapat 304 murah kalau file tidak berubah). Tanpa ini,
 * browser menyimpan CSS/JS lama berhari-hari dan perubahan tidak pernah
 * terlihat walau server sudah update — sumber kebingungan "kok gak ada
 * perubahan".
 */
const noCache = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
};
const staticOpts = { etag: true, lastModified: true };

app.use(express.json());
app.use(noCache, express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/fonts', noCache, express.static(path.join(__dirname, 'node_modules', '@fontsource'), staticOpts));
app.use('/phosphor', noCache, express.static(path.join(__dirname, 'node_modules', '@phosphor-icons', 'web', 'src'), staticOpts));

/* ------------------------------------------------------------------ */
/* Scraper (by Noisy)                                                  */
/* ------------------------------------------------------------------ */

function generateRandomFingerprint() {
    const cpuList = [4, 8, 12, 16];
    const ramList = [4, 8, 16, 32];
    const rendererList = [
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'Mali-G57 MC2',
        'Adreno (TM) 610'
    ];

    const isMobile = Math.random() > 0.5;

    return {
        cpu: cpuList[Math.floor(Math.random() * cpuList.length)],
        memory: ramList[Math.floor(Math.random() * ramList.length)],
        touch: isMobile ? Math.floor(Math.random() * 5) + 1 : 0,
        platform: isMobile ? 'Linux armv81' : 'Win32',
        lang: 'id-ID',
        vendor: 'Google Inc.',
        webgl_vendor: 'Google Inc. (NVIDIA)',
        webgl_renderer: rendererList[Math.floor(Math.random() * rendererList.length)],
        ua: isMobile
            ? 'Mozilla/5.0 (Linux; Android 13; CPH2565) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        backup_token: null
    };
}

const mergeCookies = (newCookieHeaders, currentCookies = '') => {
    if (!newCookieHeaders) return currentCookies;
    const newCookiesStr = newCookieHeaders.map(c => c.split(';')[0].trim()).join('; ');
    return currentCookies ? `${currentCookies}; ${newCookiesStr}` : newCookiesStr;
};

const UPSTREAM_TIMEOUT = 30000;

/*
 * Buka sesi upstream: ambil CSRF token, lalu daftarkan "perangkat"
 * acak supaya endpoint berikutnya mau melayani kita.
 */
async function openSession() {
    const baseUrl = 'https://flowvideoplayer.com';
    const fingerprint = generateRandomFingerprint();

    const homeResponse = await axios.get(baseUrl, {
        headers: { Accept: 'text/html', 'User-Agent': fingerprint.ua },
        timeout: UPSTREAM_TIMEOUT
    });

    const csrfMatch = homeResponse.data.match(/<meta name="csrf-token" content="([^"]+)">/);
    if (!csrfMatch) throw new Error('CSRF token tidak ditemukan pada upstream.');

    const session = {
        baseUrl,
        cookies: mergeCookies(homeResponse.headers['set-cookie']),
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-TOKEN': csrfMatch[1],
            Origin: baseUrl,
            Referer: `${baseUrl}/`,
            'User-Agent': fingerprint.ua,
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty'
        }
    };

    const initResponse = await axios.post(`${baseUrl}/device/init`, JSON.stringify(fingerprint), {
        headers: { ...session.headers, Cookie: session.cookies },
        timeout: UPSTREAM_TIMEOUT
    });

    if (initResponse.data.status !== true) {
        throw new Error('Gagal init device: ' + (initResponse.data.message || 'Unknown error'));
    }

    session.cookies = mergeCookies(initResponse.headers['set-cookie'], session.cookies);
    session.downloadsRemaining = initResponse.data.downloads_remaining;
    return session;
}

/*
 * Cari isi link berbagi. Satu link bisa berisi FOLDER dengan banyak file,
 * dan upstream selalu menyisipkan entri folder (download_url kosong) di
 * depan daftar. Entri tanpa download_url dibuang; kalau sisanya kosong,
 * link memang tidak berisi file yang bisa diambil.
 */
async function searchFiles(session, targetUrl) {
    const searchResponse = await axios.post(
        `${session.baseUrl}/telegram/bot/search/video`,
        JSON.stringify({ url: targetUrl }),
        { headers: { ...session.headers, Cookie: session.cookies }, timeout: UPSTREAM_TIMEOUT }
    );

    if (!searchResponse.data.status || !Array.isArray(searchResponse.data.response)) {
        throw new Error(searchResponse.data.message || 'Data file kosong untuk link tersebut.');
    }

    const files = searchResponse.data.response
        .filter((f) => f && typeof f.download_url === 'string' && f.download_url)
        .map((f) => {
            const fileName = withExtension(f.file_name || 'file', f.extension);
            return {
                fileName,
                fileSize: f.file_size || '',
                type: typeFromName(fileName),
                previewUrl: f.thumbnail || '',
                streamUrl: f.fast_stream_url || f.stream_url || '',
                rawUrl: f.download_url
            };
        });

    if (files.length === 0) {
        throw new Error('Link tersebut tidak berisi file yang bisa diambil.');
    }
    return files;
}

/*
 * URL mentah dari hasil pencarian sudah berupa link langsung yang bisa
 * diunduh (terverifikasi: 200 + Content-Disposition attachment), jadi
 * langkah /video/download di upstream dilewati. Itu sekaligus menghindari
 * batas kuota harian milik endpoint tersebut.
 */
async function scrapeTerabox(targetUrl) {
    const session = await openSession();
    const files = await searchFiles(session, targetUrl);

    return {
        success: true,
        files: files.map((f) => ({
            fileName: f.fileName,
            fileSize: f.fileSize,
            streamUrl: f.streamUrl,
            finalDownloadUrl: f.rawUrl
        })),
        downloadsRemaining: session.downloadsRemaining
    };
}

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

const TERABOX_HOSTS = /(^|\.)~?(1024terabox|terabox|teraboxapp|4funbox|mirrobox|nephobox|momerybox|tibibox|teraboxlink|freeterabox)\./i;

app.post('/api/download', async (req, res) => {
    const { url } = req.body || {};

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ success: false, message: 'URL TeraBox wajib diisi.' });
    }

    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch {
        return res.status(400).json({ success: false, message: 'Format URL tidak valid.' });
    }

    if (!/^https?:$/.test(parsed.protocol) || !TERABOX_HOSTS.test(parsed.hostname)) {
        return res.status(400).json({
            success: false,
            message: 'Link harus berupa URL berbagi TeraBox (contoh: https://1024terabox.com/s/xxxx).'
        });
    }

    try {
        const result = await scrapeTerabox(parsed.href);
        res.json(result);
    } catch (error) {
        const errorMsg = error.response
            ? `Layanan upstream menolak (HTTP ${error.response.status}). Coba lagi sebentar.`
            : error.code === 'ECONNABORTED'
              ? 'Waktu permintaan habis. Coba lagi.'
              : error.message || 'Terjadi kesalahan yang tidak terduga.';
        res.status(502).json({ success: false, message: errorMsg });
    }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
    console.log(`Noisy TeraBox Downloader jalan di http://localhost:${PORT}`);
});
