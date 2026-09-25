/**
 * Noisy TeraBox Downloader - server
 * Express backend yang membungkus scraper flowvideoplayer.com
 * sebagai REST API untuk frontend.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
const archiver = require('archiver');
const { PassThrough } = require('stream');

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

/* ---------- tipe file ---------- */

const VIDEO_EXT = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'];

function withExtension(name, ext) {
    if (/\.[A-Za-z0-9]{1,5}$/i.test(name)) return name;
    if (!ext || ext === '.') return name;
    return name + (ext.startsWith('.') ? ext : '.' + ext);
}

function typeFromName(name) {
    const e = (name.split('.').pop() || '').toLowerCase();
    if (VIDEO_EXT.includes(e)) return 'video';
    if (IMAGE_EXT.includes(e)) return 'image';
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(e)) return 'audio';
    return 'other';
}

function humanSize(bytes) {
    if (!bytes || bytes < 1) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + ' ' + units[i];
}

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
            type: f.type,
            previewUrl: f.previewUrl,
            streamUrl: f.streamUrl,
            finalDownloadUrl: f.rawUrl
        })),
        downloadsRemaining: session.downloadsRemaining
    };
}

/*
 * Gabungkan dua jalur:
 * - flowvideoplayer: menyuplai URL unduh/stream langsung untuk video.
 * - API share resmi: daftar isi folder LENGKAP (video, foto, file lain).
 *   Foto mendapat link unduh rendisi thumbnail (aslinya terkunci captcha
 *   untuk non-login); video yang tidak disuplai jalur pertama tetap
 *   ditampilkan apa adanya, tanpa tombol unduh (terkunci captcha di sisi
 *   TeraBox untuk sesi tanpa login).
 */
async function scrapeAll(targetUrl, ndus, cookie) {
    const [videoResult, shareFiles] = await Promise.allSettled([
        scrapeTerabox(targetUrl),
        scrapeTeraBoxShare(targetUrl, ndus, cookie)
    ]);

    const files = [];
    let downloadsRemaining;
    let videoError;

    if (videoResult.status === 'fulfilled') {
        files.push(...videoResult.value.files);
        downloadsRemaining = videoResult.value.downloadsRemaining;
    } else {
        videoError = videoResult.reason;
    }

    /* file share yang belum ada padanannya di hasil upstream (cocok via nama) */
    let shareToken = null;
    let cookieDowngraded = false;
    if (shareFiles.status === 'fulfilled') {
        const seen = new Set(files.map((f) => f.fileName.toLowerCase()));
        for (const f of shareFiles.value.entries) {
            if (seen.has(f.fileName.toLowerCase())) continue;
            seen.add(f.fileName.toLowerCase());
            files.push(f);
        }
        shareToken = shareFiles.value.token;
        cookieDowngraded = Boolean(shareFiles.value.cookieDowngraded);
    }

    if (files.length === 0) {
        /* tembok verify pada link menang atas pesan generik: penanganannya beda */
        if (shareFiles.status === 'rejected' && shareFiles.reason && shareFiles.reason.verifyRequired) {
            throw shareFiles.reason;
        }
        if (videoError) throw videoError;
        throw new Error('Link tersebut tidak berisi file yang bisa diambil.');
    }

    /* urutkan: video dulu, lalu foto, masing-masing alphabetical */
    const order = { video: 0, image: 1, audio: 2, other: 3 };
    files.sort((a, b) => (order[a.type] - order[b.type]) || a.fileName.localeCompare(b.fileName));

    /*
     * Tombol "Unduh Semua" butuh token sesi untuk menyimpan daftar file.
     * Tanpa ini, bila jalur share gagal (timeout/ditolak) atau hasilnya
     * hanya foto, token null dan handler klik di frontend diam-diam
     * mengabaikan tombol — gejala: "Unduh Semua tidak berfungsi".
     * Sesi ringan cukup: URL upstream/thumbnail sudah self-authenticated.
     */
    if (!shareToken && files.some((f) => f.finalDownloadUrl)) {
        shareToken = rememberSession({ headers: {}, zipFiles: [] });
    }
    attachZipList(shareToken, files);
    return { success: true, files, downloadsRemaining, shareToken, cookieDowngraded };
}

/* simpan daftar yang bisa diunduh di sesi, untuk endpoint ZIP (GET) */
function attachZipList(token, files) {
    const s = token && shareSessions.get(token);
    if (!s) return;
    s.zipFiles = files
        .filter((f) => f.finalDownloadUrl)
        .map((f) => ({ name: f.fileName, url: f.finalDownloadUrl }));
}

/* ------------------------------------------------------------------ */
/* Scraper foto: API web-share resmi TeraBox                           */
/* ------------------------------------------------------------------ */

/*
 * flowvideoplayer hanya mengekstrak video, jadi folder berisi foto perlu
 * jalur sendiri. API web-share TeraBox (dipetakan dari bundle JS resmi
 * mereka) bisa menampilkan isi folder tanpa login. Batasannya: unduh
 * file asli untuk non-login dikunci captcha "verify_v2", jadi untuk foto
 * kita sajikan rendisi thumbnail c1600_u1200 (resolusi terbesar yang bisa
 * diakses tanpa login) sebagai link unduh.
 */
const SHARE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SHARE_COMMON = { app_id: '250528', web: '1', channel: 'dubox', clienttype: '0', jsToken: '', lang: 'en_us' };

/*
 * Link berbagi TeraBox ada banyak bentuk: /s/xxx, /sharing/link?surl=xxx,
 * kadang dengan prefix bahasa (/indonesian/...) atau subdomain regional
 * (dm.terabox.com). Normalisasi ke bentuk kanonik supaya kedua jalur scraper
 * melihat URL yang sama dan host-nya bisa dipakai sebagai origin API.
 */
function parseShareUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        let surl = u.searchParams.get('surl') || '';
        if (!surl) {
            const m = u.pathname.match(/\/s\/([A-Za-z0-9_-]+)/);
            if (m) surl = m[1];
        }
        return { host: u.hostname, surl };
    } catch {
        return { host: '', surl: '' };
    }
}

/*
 * Daftar ISI SHARE LENGKAP lewat API web-share resmi (tanpa login).
 * Mengembalikan semua file: foto diberi link unduh rendisi thumbnail
 * (c1600_u1200 = terbesar yang bisa diakses publik; foto asli terkunci
 * captcha), video/audio/file lain tanpa URL unduh karena dlink-nya
 * dikunci captcha verify_v2 untuk sesi non-login. Sesi-nya disimpan di
 * shareSessions supaya proxy /api/file dan /api/zip bisa memakai cookie
 * sesi (termasuk ndus milik user) saat melayani dlink video.
 */
const crypto = require('crypto');
const shareSessions = new Map(); // token -> sesi share { client, headers, origin, ... }
const SESSION_TTL = 30 * 60 * 1000;

function rememberSession(s) {
    s.createdAt = Date.now();
    const token = crypto.randomBytes(12).toString('hex');
    shareSessions.set(token, s);
    // bersihkan sesi kadaluarsa sekalian
    for (const [k, v] of shareSessions) {
        if (Date.now() - v.createdAt > SESSION_TTL) shareSessions.delete(k);
    }
    return token;
}

/*
 * Bersihkan string cookie yang ditempel user. Salinan dari DevTools sering
 * membawa prefix "Cookie:", label "cookie=", atau baris/whitespace berlebih;
 * key yang tidak valid dibuang supaya header Cookie tidak ditolak axios.
 */
function sanitizeCookieString(raw) {
    let s = String(raw).trim();
    s = s.replace(/^cookie\s*:\s*/i, '').replace(/^cookie\s*=\s*/i, '');
    const out = [];
    for (const part of s.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const k = part.slice(0, eq).trim().replace(/^["']|["'];?$/g, '');
        const v = part.slice(eq + 1).trim().replace(/^["']|["'];?$/g, '');
        if (k && v && /^[A-Za-z0-9_\-.]+$/.test(k) && !/[\r\n]/.test(v)) out.push(`${k}=${v}`);
    }
    return out.join('; ');
}

/*
 * Buka sesi share. `userCookie` = string cookie login dari user (boleh kosong).
 * Bila sesi dengan cookie user ditolak upstream (errno != 0 pada shorturlinfo
 * selain tembok verify), fallback otomatis ke sesi anonim: file tetap tampil
 * seperti sebelum cookie dipasang, hanya dlink video yang kembali terkunci.
 * Mengembalikan null bila bahkan anonim gagal (link mati/dihapus).
 */
async function openShareSession(targetUrl, ndus, userCookie) {
    const { host, surl } = parseShareUrl(targetUrl);
    if (!host || !surl) return null;
    const origin = `https://${host}`;
    const client = axios.create({ timeout: UPSTREAM_TIMEOUT, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 300 });

    /* buka halaman share untuk dapat cookie sesi (TSID, browserid, dll.) */
    const jar = {};
    const page = await client.get(`${origin}/sharing/link?surl=${surl}`, {
        headers: { 'User-Agent': SHARE_UA, Accept: 'text/html' }
    });
    for (const c of page.headers['set-cookie'] || []) {
        const [kv] = c.split(';');
        const eq = kv.indexOf('=');
        const k = kv.slice(0, eq).trim();
        const v = kv.slice(eq + 1).trim();
        if (v) jar[k] = v;
    }
    const baseJar = { ...jar };

    /*
     * Cookie sesi milik akun user (opsional): membuat share/download
     * melayani dlink video, sama seperti saat user membuka situsnya sendiri.
     * Perlu string Cookie penuh dari browser yang login (berisi BDUSS).
     * ndus saja TIDAK cukup: gettemplatevariable tetap mengembalikan sesi anonim.
     */
    if (userCookie) {
        for (const part of sanitizeCookieString(userCookie).split(';')) {
            const eq = part.indexOf('=');
            if (eq < 0) continue;
            jar[part.slice(0, eq)] = part.slice(eq + 1);
        }
    }
    if (ndus) jar.ndus = ndus;
    const suppliedCookie = Boolean(userCookie || ndus);
    const buildHeaders = (j) => ({
        'User-Agent': SHARE_UA,
        Referer: `${origin}/sharing/link?surl=${surl}`,
        Cookie: Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; '),
        Accept: 'application/json, text/plain, */*'
    });
    let headers = buildHeaders(jar);
    let cookieDowngraded = false;

    /*
     * Penanda sesi login: bdstoken terisi hanya ketika cookie yang dipakai
     * benar-benar mengenali akun. Dipakai untuk melaporkan status ke user
     * supaya cookie salah/kedaluwarsa ketahuan, bukan jadi "Terkunci" senyap.
     */
    async function checkLoggedIn(h) {
        try {
            const tv = (await client.get(`${origin}/api/gettemplatevariable`, {
                params: { fields: JSON.stringify(['bdstoken', 'uk', 'jsToken']) }, headers: h
            })).data;
            const r = (tv && tv.result) || tv || {};
            return Boolean(r.bdstoken);
        } catch { return false; }
    }
    let accountLoggedIn = await checkLoggedIn(headers);

    /*
     * Info share: shareid/uk/sign/timestamp + path folder akar.
     * Cookie user yang buruk bisa bikin upstream mengembalikan errno != 0
     * atau bahkan HTTP 4xx; keduanya harus jatuh ke sesi anonim, bukan
     * membuat seluruh permintaan gagal. Tembok verify pada LINK
     * (400210/400141) dikecualikan: itu kasus yang butuh cookie login,
     * bukan cookie rusak.
     */
    const fetchInfo = (h) => client.get(`${origin}/api/shorturlinfo`, {
        params: { ...SHARE_COMMON, shorturl: `1${surl}`, root: 1, scene: '' }, headers: h
    }).then((r) => r.data).catch(() => null);

    let info = await fetchInfo(headers);
    const verifyWall = info && (+info.errno === 400210 || +info.errno === 400141);
    const needFallback = suppliedCookie && (!info || (+info.errno !== 0 && !verifyWall));
    if (needFallback) {
        const anonHeaders = buildHeaders(baseJar);
        const anonInfo = await fetchInfo(anonHeaders);
        if (anonInfo && +anonInfo.errno === 0) {
            headers = anonHeaders;
            accountLoggedIn = false;
            cookieDowngraded = true;
            info = anonInfo;
        }
    }
    if (!info) return null;
    /*
     * 400210/400141 "need verify(_v2)": TeraBox memasang tembok verifikasi
     * pada LINK ini (akun pemilik ditandai berisiko). Sesi anonim selalu
     * ditolak; dengan cookie login milik user, tembok ini dilewati secara
     * resmi oleh TeraBox sendiri.
     */
    if (+info.errno === 400210 || +info.errno === 400141) {
        const err = new Error('Link ini dilindungi verifikasi TeraBox.');
        err.verifyRequired = true;
        err.accountLoggedIn = accountLoggedIn;
        throw err;
    }
    if (+info.errno !== 0) return null;
    const rootPath = info.list && info.list[0] && info.list[0].path;
    if (!rootPath) return null;
    const auth = { uk: info.uk_str, shareid: info.shareid, sign: info.sign, timestamp: info.timestamp, shorturl: surl };

    return { client, headers, origin, host, surl, rootPath, auth, accountLoggedIn, cookieDowngraded };
}

async function scrapeTeraBoxShare(targetUrl, ndus, cookie) {
    const session = await openShareSession(targetUrl, ndus, cookie);
    if (!session) return { entries: [], token: null };
    const { client, headers, auth, rootPath, origin } = session;

    /* telusuri BFS semua subfolder (kedalaman terbatas) */
    const entries = [];
    const queue = [rootPath];
    const seen = new Set();
    let dirsVisited = 0;
    while (queue.length && dirsVisited < 30 && entries.length < 500) {
        const dir = queue.shift();
        if (seen.has(dir)) continue;
        seen.add(dir);
        dirsVisited++;
        let listing;
        try {
            listing = (await client.get(`${session.origin}/share/list`, {
                params: { ...SHARE_COMMON, ...auth, dir, page: 1, num: 100, order: 'name', desc: 0, category: 0 },
                headers
            })).data;
        } catch { continue; }
        if (!listing || +listing.errno !== 0) continue;
        for (const f of listing.list || []) {
            if (+f.isdir === 1) { queue.push(f.path); continue; }
            const name = withExtension(f.server_filename || 'file', '');
            const type = typeFromName(name);
            const thumbBase = f.thumbs
                ? (f.thumbs.url3 || f.thumbs.url2 || f.thumbs.url1 || '').split('&size=')[0]
                : '';
            const entry = {
                fileName: name,
                fsId: String(f.fs_id || ''),
                fileSize: f.size ? humanSize(Number(f.size)) : '',
                type,
                previewUrl: thumbBase ? thumbBase + '&size=c850_u580&quality=100' : '',
                finalDownloadUrl: '',
                streamUrl: ''
            };
            if (type === 'image' && thumbBase) {
                /* rendisi c1600_u1200 = kualitas terbesar tanpa login;
                   foto asli terkunci captcha di sisi TeraBox */
                entry.finalDownloadUrl = thumbBase + '&size=c1600_u1200&quality=100&fn=' + encodeURIComponent(name);
            }
            entries.push(entry);
        }
    }

    /*
     * Dengan sesi login yang mengenali akun (bdstoken terisi),
     * share/download resmi melayani dlink untuk video (tanpa captcha,
     * karena sesi sudah terverifikasi login). ndus saja tidak cukup.
     */
    if (session.accountLoggedIn) {
        const vids = entries.filter((e) => e.type === 'video' && e.fsId);
        for (let i = 0; i < vids.length; i += 20) {
            const chunk = vids.slice(i, i + 20);
            try {
                const dl = (await client.get(`${origin}/share/download`, {
                    params: { ...SHARE_COMMON, ...auth, fid_list: JSON.stringify(chunk.map((e) => e.fsId)), primaryid: auth.shareid, product: 'share', type: 'dlink', dl: 0, version: '2', scene: '' },
                    headers
                })).data;
                const links = dl && dl.links;
                if (Array.isArray(links)) {
                    for (const e of chunk) {
                        const hit = links.find((l) => String(l.fs_id) === String(e.fsId) && l.dlink);
                        if (hit) {
                            /* dlink sudah membawa Content-Disposition sendiri,
                               jadi browser bisa unduh langsung dari CDN (cepat) */
                            e.finalDownloadUrl = hit.dlink;
                            e.streamUrl = hit.dlink;
                        }
                    }
                }
            } catch { /* dlink gagal: video tetap tampil, tanpa tombol unduh */ }
        }
    }

    const token = entries.some((e) => e.type !== 'image') ? rememberSession(session) : null;
    return { entries, token, cookieDowngraded: Boolean(session.cookieDowngraded) };
}

/* ------------------------------------------------------------------ */
/* API routes                                                          */
/* ------------------------------------------------------------------ */

const TERABOX_HOSTS = /(^|\.)~?(1024terabox|terabox|teraboxapp|4funbox|mirrobox|nephobox|momerybox|tibibox|teraboxlink|freeterabox)\./i;

app.post('/api/download', async (req, res) => {
    const { url, ndus, cookie } = req.body || {};

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

    /*
     * Bentuk link berbagi sangat beragam (prefix bahasa, /sharing/link?surl=,
     * subdomain regional). Kanonkan ke https://<host>/s/<surl> supaya kedua
     * jalur scraper menerima URL yang konsisten.
     */
    const { surl } = parseShareUrl(parsed.href);
    const canonical = surl ? `https://${parsed.hostname}/s/${surl}` : parsed.href;

    const cleanNdus = typeof ndus === 'string' && ndus.trim() ? ndus.trim() : null;
    const cleanCookie = typeof cookie === 'string' && cookie.trim() ? cookie.trim() : null;

    try {
        const result = await scrapeAll(canonical, cleanNdus, cleanCookie);
        res.json(result);
    } catch (error) {
        if (error && error.verifyRequired) {
            /*
             * Bedakan dua kasus supaya user tidak menebak-nebak:
             * cookie belum dipasang vs cookie dipasang tapi tidak dikenali
             * sebagai sesi login (ndus saja tidak cukup, perlu BDUSS).
             */
            const usingCookie = Boolean(cleanCookie || cleanNdus);
            return res.status(424).json({
                success: false,
                needVerify: true,
                cookieRejected: usingCookie && !error.accountLoggedIn,
                message: !usingCookie
                    ? 'TeraBox mengunci link ini dengan verifikasi (hanya untuk akun login). Tempel cookie sesi akun TeraBox Anda di bawah, lalu ambil ulang link.'
                    : error.accountLoggedIn
                        ? 'TeraBox menolak sesi login ini untuk link tersebut. Pastikan Anda login ke akun yang sama dengan yang menyimpan file ini.'
                        : 'Cookie yang ditempel tidak dikenali sebagai sesi login. ndus saja tidak cukup, tempel string Cookie penuh yang berisi BDUSS.'
            });
        }
        const errorMsg = error.response
            ? `Layanan upstream menolak (HTTP ${error.response.status}). Coba lagi sebentar.`
            : error.code === 'ECONNABORTED'
              ? 'Waktu permintaan habis. Coba lagi.'
              : error.message || 'Terjadi kesalahan yang tidak terduga.';
        res.status(502).json({ success: false, message: errorMsg });
    }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/* ------------------------------------------------------------------ */
/* Statistik pengunjung (first-party, tanpa cookie & tanpa IP)         */
/* ------------------------------------------------------------------ */

/*
 * Ping dari frontend membawa session id acak yang dibuat browser user
 * dan tersimpan di localStorage-nya sendiri. Server hanya menghitung:
 *  - online : sesi yang masih berdenyut (heartbeat <= 65 detik)
 *  - total  : jumlah kunjungan (sesi baru) sepanjang waktu
 * Angka dipersist ke data/visits.json secara best-effort — di Vercel
 * disk read-only/serverless ephemeral, statistik tetap jalan (in-memory)
 * tapi angka total tidak lintas instance.
 */
const VISITS_FILE = path.join(__dirname, 'data', 'visits.json');
const visits = { online: new Map(), total: 0, lastSave: 0 };

try {
    const raw = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8'));
    visits.total = Number(raw.total) || 0;
} catch { /* file belum ada: mulai dari nol */ }

function persistVisits(force) {
    const now = Date.now();
    if (!force && now - visits.lastSave < 15000) return;
    visits.lastSave = now;
    try {
        fs.mkdirSync(path.dirname(VISITS_FILE), { recursive: true });
        fs.writeFileSync(VISITS_FILE, JSON.stringify({ total: visits.total }));
    } catch { /* serverless read-only: abaikan */ }
}

app.get('/api/visit', (req, res) => {
    const sid = String(req.query.sid || '').toLowerCase();
    const now = Date.now();
    for (const [k, t] of visits.online) if (now - t > 65000) visits.online.delete(k);
    if (/^[a-f0-9]{8,48}$/.test(sid)) {
        if (!visits.online.has(sid)) visits.total++;
        visits.online.set(sid, now);
        persistVisits();
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, online: visits.online.size, total: visits.total });
});

/*
 * Unduh semua sekaligus: GET /api/zip?d=<token sesi>. Daftar file diambil
 * dari hasil /api/download yang tersimpan di sesi (hanya yang punya URL
 * unduh). Ini link biasa, jadi browser menanganinya sebagai download
 * progresif native (tanpa fetch+blob yang tersedot memori/terputus).
 * Nama file diduplikasi diberi imbuhan (2), (3), dst.
 */
app.get('/api/zip', async (req, res) => {
    const token = String(req.query.d || '');
    const share = token && shareSessions.get(token);
    const safe = share && Array.isArray(share.zipFiles) ? share.zipFiles.slice(0, 300) : [];
    if (safe.length === 0) return res.status(400).json({ success: false, message: 'Sesi kedaluwarsa atau tidak ada file untuk diarsipkan.' });

    let fetched = 0;
    const archive = archiver('zip', { zlib: { level: 0 } }); // stream gambar: kompresi cuma buang CPU
    archive.on('error', () => res.destroy());

    const zipName = `terabox-${Date.now()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Cache-Control', 'no-store');
    archive.pipe(res);

    const usedNames = new Map();
    const uniqueName = (name) => {
        const base = (name || 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) || 'file';
        const n = (usedNames.get(base) || 0) + 1;
        usedNames.set(base, n);
        if (n === 1) return base;
        const dot = base.lastIndexOf('.');
        return dot > 0
            ? `${base.slice(0, dot)} (${n})${base.slice(dot)}`
            : `${base} (${n})`;
    };

    /* nama ditetapkan berurutan di awal (deterministik walau unduh paralel) */
    const jobs = [];
    for (const f of safe) {
        let parsed;
        try { parsed = new URL(f.url); } catch { continue; }
        const isThumb = parsed.pathname.startsWith('/thumbnail/');
        const allowed = share ? DLINK_HOSTS : PHOTO_HOSTS;
        if (parsed.protocol !== 'https:' || !allowed.test(parsed.hostname) || (!isThumb && !share)) continue;
        jobs.push({ url: f.url, name: uniqueName(f.name), isThumb });
    }
    if (jobs.length === 0) {
        archive.abort();
        if (!res.headersSent) return res.status(502).json({ success: false, message: 'Semua file gagal diambil dari sumber.' });
        return res.destroy();
    }
    console.log('[zip] daftar sesi:', safe.length, '| lolos filter:', jobs.length, '| video:', jobs.filter((j) => !j.isThumb).length);

    /* unduh paralel (8 koneksi) dengan RESUME: CDN sering memutus koneksi
       panjang tanpa error (file terpotong diam-diam). Tiap stream dicek
       terhadap Content-Length; kalau kurang, sambung lagi pakai Range. */
    const QUEUE = 8;
    const MAX_RESUME = 6;

    /* mengembalikan PassThrough yang dijamin mengirim `expected` byte
       (atau menyerah setelah MAX_RESUME percobaan resume) */
    function resumableStream(url, baseHeaders, expected) {
        const out = new PassThrough();
        let received = 0;
        let attempts = 0;
        function pull(from) {
            const headers = { ...baseHeaders };
            if (from > 0) headers.Range = `bytes=${from}-`;
            axios.get(url, { responseType: 'stream', timeout: 60000, maxRedirects: 5, headers })
                .then((up) => {
                    up.data.on('data', (b) => { received += b.length; out.write(b); });
                    up.data.on('error', retry);
                    up.data.on('end', retry);
                })
                .catch(retry);
            function retry() {
                attempts++;
                if (expected > 0 && received >= expected) return out.end();
                /* tanpa panjang dikenal: terima hanya bila ada isinya; stream
                   kosong = kegagalan diam-diam upstream, coba lagi */
                if (!expected && received > 0 && attempts === 1) return out.end();
                if (attempts > MAX_RESUME) {
                    console.log('[zip] menyerah setelah', attempts, 'percobaan:', url.slice(0, 70), `(${received}/${expected || '?'} byte)`);
                    return out.end();
                }
                if (received === 0 || (expected > 0 && received < expected)) {
                    console.log('[zip] resume', received + '/' + (expected || '?'), '->', url.slice(0, 70));
                    setTimeout(() => pull(received), 400);
                } else {
                    out.end();
                }
            }
        }
        pull(0);
        return out;
    }

    let cursor = 0;
    async function worker() {
        while (cursor < jobs.length) {
            const job = jobs[cursor++];
            try {
                const headers = { 'User-Agent': SHARE_UA };
                /* sesi share asli membawa cookie; sesi fallback (tanpa jalur
                   share) headers-nya kosong — jangan kirim nilai undefined */
                if (!job.isThumb && share && share.headers && share.headers.Cookie) {
                    headers.Cookie = share.headers.Cookie;
                    headers.Referer = share.headers.Referer;
                }
                /* cek panjang dulu lewat Range 0-0 (murah, CDN dukung 206) */
                let expected = 0;                try {
                    const head = await axios.get(job.url, {
                        responseType: 'stream', timeout: 30000, maxRedirects: 5,
                        headers: { ...headers, Range: 'bytes=0-0' }
                    });
                    const cr = head.headers['content-range'];
                    if (cr) expected = Number(cr.split('/')[1]) || 0;
                    head.data.destroy();
                } catch { /* beberapa host menolak Range: jalankan tanpa expected */ }
                const stream = resumableStream(job.url, headers, expected);
                archive.append(stream, { name: job.name });
                fetched++;
            } catch (e) { /* file gagal diambil: lewati, sisanya tetap masuk arsip */
                console.log('[zip] gagal:', (job && job.name) || '?', e.response ? `HTTP ${e.response.status}` : e.message.slice(0, 120));
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(QUEUE, jobs.length) }, worker));

    if (fetched === 0) {
        archive.abort();
        if (!res.headersSent) return res.status(502).json({ success: false, message: 'Semua file gagal diambil dari sumber.' });
        return res.destroy();
    }
    archive.finalize();
});

/*
 * Proxy unduh untuk rendisi foto. Endpoint thumbnail TeraBox tidak
 * mengirim Content-Disposition, jadi tanpa proxy ini klik hanya membuka
 * gambar di tab baru. Host dikunci ke CDN thumbnail saja.
 *
 * Catatan: host thumbnail ikut region server pemilik file, bukan hanya
 * teraboxcdn. Contoh region "dm" menyajikan dari dm-data.terabox.com.
 * Karena itu semua subdomain terabox.com/terabox.app/teraboxcdn.com
 * diizinkan, selama path-nya /thumbnail/.
 */
const PHOTO_HOSTS = /(^|\.)(terabox\.com|terabox\.app|teraboxcdn\.com)$/i;
/* host CDN unduhan (dlink) keluarga netdisk/worker, dipakai hanya bila token sesi valid */
const DLINK_HOSTS = /(^|\.)(terabox\.com|terabox\.app|teraboxcdn\.com|teraboxdl\.site|pcsdl\.com|baidupcs\.com)$/i;
/*
 * Host stream HLS: playlist disajikan oleh CDN unduhan, segmennya oleh
 * worker Cloudflare acak (workers.dev). Keduanya tidak mengirim header
 * CORS, jadi hls.js di browser selalu ditolak — stream wajib lewat proxy.
 */
const STREAM_HOSTS = /(^|\.)(terabox\.com|terabox\.app|teraboxcdn\.com|teraboxpage\.com|teraboxdl\.site|pcsdl\.com|baidupcs\.com|workers\.dev)$/i;
/* dlink butuh cookie sesi: lewat proxy, bukan link langsung ke browser */
app.get('/api/file', async (req, res) => {
    const u = String(req.query.u || '');
    const token = String(req.query.d || '');
    const share = token && shareSessions.get(token);
    let parsed;
    try {
        parsed = new URL(u);
    } catch {
        return res.status(400).send('URL tidak valid.');
    }
    const isThumb = parsed.pathname.startsWith('/thumbnail/');
    const allowed = share ? DLINK_HOSTS : PHOTO_HOSTS;
    if (parsed.protocol !== 'https:' || !allowed.test(parsed.hostname) || (!isThumb && !share)) {
        return res.status(400).send('Hanya sumber thumbnail TeraBox yang dilayani.');
    }
    const name = String(req.query.n || 'foto.jpg').replace(/["\\\r\n]/g, '').slice(0, 120);
    try {
        const headers = { 'User-Agent': SHARE_UA };
        if (!isThumb && share && share.headers && share.headers.Cookie) {
            /* dlink butuh cookie sesi share tempat ia diterbitkan */
            headers.Cookie = share.headers.Cookie;
            headers.Referer = share.headers.Referer;
        }
        const upstream = await axios.get(u, {
            responseType: 'stream', timeout: 120000, maxRedirects: 5,
            headers
        });
        res.setHeader('Content-Type', upstream.headers['content-type'] || (isThumb ? 'image/jpeg' : 'video/mp4'));
        if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
        res.setHeader('Cache-Control', 'no-store');
        upstream.data.on('error', () => res.destroy());
        upstream.data.pipe(res);
    } catch (e) {
        console.log('[file] proxy gagal:', e.response ? `HTTP ${e.response.status}` : e.message, '|', u.slice(0, 90));
        res.status(502).send('Gagal mengambil berkas dari sumber.');
    }
});

app.get('/api/stream', async (req, res) => {
    const u = String(req.query.u || '');
    let parsed;
    try {
        parsed = new URL(u);
    } catch {
        return res.status(400).send('URL tidak valid.');
    }
    if (parsed.protocol !== 'https:' || !STREAM_HOSTS.test(parsed.hostname)) {
        return res.status(400).send('Hanya sumber stream TeraBox yang dilayani.');
    }
    try {
        const upstream = await axios.get(u, {
            responseType: 'stream', timeout: 120000, maxRedirects: 5,
            headers: { 'User-Agent': SHARE_UA }
        });
        const ct = upstream.headers['content-type'] || '';
        if (ct.includes('mpegurl') || /m3u8/i.test(u)) {
            /* playlist: baca penuh, tulis ulang tiap baris URL segmen lewat
               proxy ini (segmen aslinya di workers.dev tanpa CORS juga) */
            const chunks = [];
            for await (const c of upstream.data) chunks.push(c);
            const rewritten = Buffer.concat(chunks).toString('utf8').split('\n').map((line) => {
                const t = line.trim();
                if (!t || t.startsWith('#')) return line;
                return '/api/stream?u=' + encodeURIComponent(t);
            }).join('\n');
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Cache-Control', 'no-store');
            res.send(rewritten);
            return;
        }
        res.setHeader('Content-Type', ct || 'video/mp2t');
        if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
        res.setHeader('Cache-Control', 'no-store');
        upstream.data.on('error', () => res.destroy());
        upstream.data.pipe(res);
    } catch (e) {
        console.log('[stream] proxy gagal:', e.response ? `HTTP ${e.response.status}` : e.message, '|', u.slice(0, 90));
        res.status(502).send('Gagal mengambil stream dari sumber.');
    }
});

/*
 * Vercel (@vercel/node) memakai ekspor app ini sebagai handler lambda —
 * listen() hanya boleh jalan saat dijalankan langsung (lokal/VPS),
 * bukan saat modul dimuat oleh runtime serverless.
 */
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Noisy TeraBox Downloader jalan di http://localhost:${PORT}`);
    });
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => { persistVisits(true); process.exit(0); });
    }
}

module.exports = app;
