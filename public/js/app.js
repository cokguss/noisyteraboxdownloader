/* Noisy TeraBox Downloader - frontend logic */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const form = $("dlForm");
  const input = $("urlInput");
  const inputRow = input.closest(".input-row");
  const btnSubmit = $("btnSubmit");
  const btnLabel = btnSubmit.querySelector(".btn-label");
  const btnIcon = btnSubmit.querySelector("i");
  const formError = $("formError");
  const btnPaste = $("btnPaste");
  const cookieStrip = $("cookieStrip");
  const ndusInput = $("ndusInput");
  const btnApplyNdus = $("btnApplyNdus");

  /* cookie sesi (opsional) tersimpan lokal di browser user saja */
  try {
    const saved = localStorage.getItem("shareCookie") || localStorage.getItem("ndus");
    if (saved) ndusInput.value = saved;
  } catch {}

  /*
   * Kolom menerima dua bentuk: string Cookie penuh ("BDUSS=...; ndus=...")
   * atau nilai ndus telanjang. Yang kedua diketahui dari tidak adanya "=";
   * dikirim sebagai ndus, tetapi akan ditolak upstream sebagai sesi tamu
   * (pengalaman lama). Bentuk penuh dikirim sebagai cookie.
   */
  function sessionCookieParams() {
    const raw = ndusInput.value.trim();
    if (!raw) return {};
    if (raw.includes("=")) return { cookie: raw };
    return { ndus: raw };
  }

  const resultsSection = $("results");
  const resultsTitle = $("resultsTitle");
  const resultsSub = $("resultsSub");
  const resultsBody = $("resultsBody");
  const btnClear = $("btnClear");
  const btnZip = $("btnZip");
  const zipLabel = btnZip.querySelector(".btn-label");
  const rcNote = $("rcNote");

  /* ---------- helpers ---------- */
  const escapeText = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

  /* link unduh lewat proxy server supaya browser menyimpan, bukan membuka tab.
     Param `d` = token sesi share; server pakai hanya untuk dlink video. */
  let shareToken = null;
  const dlHref = (url, name) =>
    `/api/file?u=${encodeURIComponent(url)}&n=${encodeURIComponent(name || "file")}` +
    (shareToken ? `&d=${encodeURIComponent(shareToken)}` : "");

  /* stream HLS lewat proxy: playlist & segmen upstream tidak mengirim
     header CORS, jadi hls.js yang minta langsung ke CDN selalu ditolak. */
  const streamHref = (url) => `/api/stream?u=${encodeURIComponent(url)}`;

  function setError(msg) {
    if (!msg) {
      formError.hidden = true;
      inputRow.classList.remove("is-error");
      return;
    }
    formError.innerHTML = `<i class="ph-bold ph-warning-circle"></i> ${msg}`;
    formError.hidden = false;
    inputRow.classList.add("is-error");
  }

  function setLoading(on) {
    btnSubmit.disabled = on;
    btnLabel.textContent = on ? "Memproses..." : "Ambil File";
    btnIcon.className = on ? "spin" : "ph-bold ph-arrow-down";
  }

  function showResults() { resultsSection.hidden = false; }
  function hideResults() { resultsSection.hidden = true; resultsBody.innerHTML = ""; }

  /* ---------- HLS loader (dipakai hanya saat tombol Stream ditekan) ---------- */
  let hlsPromise = null;
  function loadHls() {
    if (window.Hls) return Promise.resolve();
    if (!hlsPromise) {
      hlsPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { hlsPromise = null; reject(new Error("hls.js gagal dimuat")); };
        document.head.appendChild(s);
      });
    }
    return hlsPromise;
  }

  async function attachStream(videoEl, src) {
    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = src;
      videoEl.play().catch(() => {});
      return;
    }
    await loadHls();
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls();
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
      hls.loadSource(src);
      videoEl.__hls = hls;
    } else {
      videoEl.src = src;
    }
  }

  function detachStream(videoEl) {
    if (videoEl.__hls) {
      try { videoEl.__hls.destroy(); } catch {}
      videoEl.__hls = null;
    }
    videoEl.removeAttribute("src");
    videoEl.load();
  }

  /* ---------- render hasil ---------- */
  function renderSkeleton() {
    showResults();
    resultsTitle.textContent = "Mengambil daftar file...";
    resultsSub.textContent = "";
    rcNote.hidden = true;
    resultsBody.innerHTML =
      `<div class="results-skeleton">` +
      `<div class="sk-block"></div><div class="sk-line sk-w40"></div>` +
      `<div class="sk-block"></div><div class="sk-line sk-w70"></div>` +
      `<div class="sk-block"></div><div class="sk-line sk-w55"></div>` +
      `<span class="sk-status">Membaca isi link TeraBox</span>` +
      `</div>`;
  }

  function videoRow(f) {
    const canStream = Boolean(f.streamUrl);
    const canDl = Boolean(f.finalDownloadUrl);
    const dlUrl = canDl ? f.finalDownloadUrl : "";
    return (
      `<div class="vid-row" data-name="${escapeAttr(f.fileName)}">` +
        (canStream
          ? `<button type="button" class="vid-thumb" aria-label="Putar ${escapeAttr(f.fileName)}">` +
              (f.previewUrl
                ? `<img src="${escapeAttr(f.previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
                : `<span class="thumb-fallback"><i class="ph-bold ph-film-strip"></i></span>`) +
              `<span class="vid-play"><i class="ph-fill ph-play-circle"></i></span>` +
            `</button>`
          : `<div class="vid-thumb is-static">` +
              (f.previewUrl
                ? `<img src="${escapeAttr(f.previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
                : `<span class="thumb-fallback"><i class="ph-bold ph-film-strip"></i></span>`) +
            `</div>`) +
        `<div class="vid-info">` +
          `<p class="vid-name" title="${escapeAttr(f.fileName)}">${escapeText(f.fileName)}</p>` +
          `<p class="vid-size">${escapeText(f.fileSize || "ukuran tidak dilaporkan")}</p>` +
        `</div>` +
        `<div class="vid-actions">` +
          (canDl
            ? `<a class="btn-primary" href="${escapeAttr(dlUrl)}" target="_blank" rel="noopener"><span class="btn-label">Unduh</span><i class="ph-bold ph-download-simple"></i></a>`
            : `<span class="locked-chip" title="TeraBox mengunci unduhan video ini untuk sesi tanpa login"><i class="ph-bold ph-lock-key"></i><span class="btn-label">Terkunci</span></span>`) +
          (canStream
            ? `<button type="button" class="btn-ghost btn-stream"><span class="btn-label">Stream</span><i class="ph ph-play"></i></button>`
            : "") +
        `</div>` +
      `</div>`
    );
  }

  function photoCell(f) {
    const canDl = Boolean(f.finalDownloadUrl);
    return (
      `<figure class="photo-cell">` +
        `<button type="button" class="photo-view" aria-label="Lihat ${escapeAttr(f.fileName)}">` +
          (f.previewUrl
            ? `<img src="${escapeAttr(f.previewUrl)}" alt="${escapeAttr(f.fileName)}" loading="lazy" referrerpolicy="no-referrer" data-full="${escapeAttr(f.finalDownloadUrl)}" data-name="${escapeAttr(f.fileName)}" />`
            : `<span class="thumb-fallback"><i class="ph-bold ph-image"></i></span>`) +
        `</button>` +
        `<figcaption class="photo-foot">` +
          `<span class="photo-name" title="${escapeAttr(f.fileName)}">${escapeText(f.fileName)}</span>` +
          (canDl
            ? `<a class="photo-dl" href="${escapeAttr(dlHref(f.finalDownloadUrl, f.fileName))}" title="Unduh ${escapeAttr(f.fileName)}" aria-label="Unduh ${escapeAttr(f.fileName)}"><i class="ph-bold ph-download-simple"></i></a>`
            : `<span class="photo-dl is-locked" title="Terkunci captcha oleh TeraBox"><i class="ph-bold ph-lock-key"></i></span>`) +
        `</figcaption>` +
      `</figure>`
    );
  }

  function renderResult(d) {
    const files = d.files || [];
    const videos = files.filter((f) => f.type === "video");
    const photos = files.filter((f) => f.type === "image");
    const others = files.filter((f) => f.type !== "video" && f.type !== "image");

    showResults();
    if (files.length === 0) {
      resultsTitle.textContent = "Tidak ada file yang bisa diambil";
      resultsSub.textContent = "Link terbuka, tapi isinya kosong atau semuanya dikunci sumbernya.";
      resultsBody.innerHTML = `<div class="empty-state"><i class="ph-bold ph-folder-open"></i><p>Tidak ada file yang bisa ditampilkan dari link ini.</p></div>`;
      rcNote.hidden = true;
      btnZip.hidden = true;
      cookieStrip.hidden = true;
      return;
    }
    resultsTitle.textContent = files.length === 1 ? "1 file ditemukan" : `${files.length} file ditemukan`;
    const bits = [];
    if (videos.length) bits.push(`${videos.length} video`);
    if (photos.length) bits.push(`${photos.length} foto`);
    if (others.length) bits.push(`${others.length} file lain`);
    resultsSub.textContent = bits.join(", ");
    resultsBody.innerHTML = "";

    if (videos.length) {
      resultsBody.insertAdjacentHTML(
        "beforeend",
        `<div class="rg"><p class="rg-title"><i class="ph-bold ph-film-strip"></i>Video <span class="rg-count">${videos.length}</span></p><div class="vid-list">${videos.map(videoRow).join("")}</div></div>`
      );
    }
    if (photos.length) {
      resultsBody.insertAdjacentHTML(
        "beforeend",
        `<div class="rg"><p class="rg-title"><i class="ph-bold ph-image"></i>Foto <span class="rg-count">${photos.length}</span></p><div class="photo-grid">${photos.map(photoCell).join("")}</div></div>`
      );
    }
    if (others.length) {
      resultsBody.insertAdjacentHTML(
        "beforeend",
        `<div class="rg"><p class="rg-title"><i class="ph-bold ph-files"></i>Lainnya <span class="rg-count">${others.length}</span></p><div class="vid-list">${others.map(videoRow).join("")}</div></div>`
      );
    }

    if (d.downloadsRemaining !== undefined && d.downloadsRemaining !== null) {
      rcNote.innerHTML = `Sisa kuota pada sesi upstream: <strong>${d.downloadsRemaining}</strong>. Link unduhan berlaku beberapa jam.`;
      rcNote.hidden = false;
    } else {
      rcNote.hidden = true;
    }

    /* strip cookie: hanya saat masih ada video yang terkunci */
    const lockedVideos = files.filter((f) => f.type === "video" && !f.finalDownloadUrl).length;
    cookieStrip.hidden = lockedVideos === 0;
    if (lockedVideos > 0) {
      /*
       * dlink video butuh sesi login. Kalau user sudah menempel cookie tapi
       * server jatuh ke sesi anonim (cookie ditolak upstream), katakan itu,
       * jangan disuruh menebak.
       */
      cookieStrip.querySelector("strong").textContent = d.cookieDowngraded
        ? `Cookie sesi Anda ditolak server TeraBox, ${lockedVideos} video terkunci.`
        : `${lockedVideos} video masih terkunci.`;
    }

    /* tombol Unduh Semua: hanya file yang benar-benar punya URL unduh */
    const dlCount = files.filter((f) => f.finalDownloadUrl).length;
    if (dlCount > 1) {
      btnZip.hidden = false;
      zipLabel.textContent = `Unduh Semua (${dlCount})`;
    } else {
      btnZip.hidden = true;
    }

    bindResultEvents();
  }

  /* ---------- interaksi dalam hasil ---------- */
  function bindRowStream(el) {
    if (!el) return;
    el.addEventListener("click", () => {
      const row = el.closest(".vid-row");
      if (!row) return;
      const name = row.dataset.name;
      const existing = row.querySelector(".vid-player");
      if (existing) {
        detachStream(existing.querySelector("video"));
        existing.remove();
        return;
      }
      resultsBody.querySelectorAll(".vid-player").forEach((p) => {
        detachStream(p.querySelector("video"));
        p.remove();
      });
      const data = fileDataByName(name);
      const player = document.createElement("div");
      player.className = "vid-player";
      player.innerHTML = `<video controls playsinline></video>`;
      row.appendChild(player);
      const videoEl = player.querySelector("video");
      if (data && data.streamUrl) {
        attachStream(videoEl, streamHref(data.streamUrl)).catch(() => {
          /* streamer tidak bisa memutar format ini; tautan unduh tetap tersedia */
        });
      }
      player.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function bindResultEvents() {
    /* satu pemutar aktif: baris yang dibuka menampilkan <video> inline */
    resultsBody.querySelectorAll(".vid-thumb:not(.is-static), .btn-stream").forEach(bindRowStream);

    const photoBtns = Array.from(resultsBody.querySelectorAll(".photo-view"));
    photoBtns.forEach((btn, i) => {
      btn.addEventListener("click", () => openLightbox(i, photoBtns));
    });
  }

  let lastData = null;
  function fileDataByName(name) {
    if (!lastData) return null;
    return (lastData.files || []).find((f) => f.fileName === name) || null;
  }

  /* ---------- lightbox foto (galeri: prev/next tanpa close) ---------- */
  let lightboxEl = null;
  let galleryItems = [];
  let galleryIndex = 0;

  function openLightbox(index, btns) {
    closeLightbox();
    galleryItems = btns.map((b) => {
      const img = b.querySelector("img");
      return {
        preview: img ? img.getAttribute("src") : "",
        full: img ? img.dataset.full : "",
        name: img ? img.dataset.name : ""
      };
    });
    galleryIndex = index;

    lightboxEl = document.createElement("div");
    lightboxEl.className = "lightbox";
    lightboxEl.setAttribute("role", "dialog");
    lightboxEl.setAttribute("aria-label", "Galeri foto");
    lightboxEl.innerHTML =
      `<button type="button" class="lightbox-close" aria-label="Tutup"><i class="ph-bold ph-x"></i></button>` +
      `<button type="button" class="lightbox-nav lb-prev" aria-label="Foto sebelumnya"><i class="ph-bold ph-caret-left"></i></button>` +
      `<figure class="lightbox-stage">` +
        `<img alt="" referrerpolicy="no-referrer" />` +
        `<figcaption class="lightbox-bar">` +
          `<p class="lb-name"></p>` +
          `<span class="lb-count"></span>` +
          `<a class="btn-primary lb-dl"><span class="btn-label">Unduh</span><i class="ph-bold ph-download-simple"></i></a>` +
        `</figcaption>` +
      `</figure>` +
      `<button type="button" class="lightbox-nav lb-next" aria-label="Foto berikutnya"><i class="ph-bold ph-caret-right"></i></button>`;
    document.body.appendChild(lightboxEl);
    document.body.style.overflow = "hidden";

    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl) closeLightbox();
    });
    lightboxEl.querySelector(".lightbox-close").addEventListener("click", closeLightbox);
    lightboxEl.querySelector(".lb-prev").addEventListener("click", () => showSlide(galleryIndex - 1));
    lightboxEl.querySelector(".lb-next").addEventListener("click", () => showSlide(galleryIndex + 1));
    showSlide(index);
  }

  function showSlide(i) {
    if (!lightboxEl || !galleryItems.length) return;
    galleryIndex = (i + galleryItems.length) % galleryItems.length;
    const item = galleryItems[galleryIndex];
    const img = lightboxEl.querySelector(".lightbox-stage img");
    img.src = item.preview;
    img.alt = item.name;
    lightboxEl.querySelector(".lb-name").textContent = item.name;
    lightboxEl.querySelector(".lb-count").textContent = `${galleryIndex + 1} dari ${galleryItems.length}`;
    const dl = lightboxEl.querySelector(".lb-dl");
    if (item.full) {
      dl.hidden = false;
      dl.href = dlHref(item.full, item.name);
    } else {
      dl.hidden = true;
    }
    const single = galleryItems.length < 2;
    lightboxEl.querySelector(".lb-prev").hidden = single;
    lightboxEl.querySelector(".lb-next").hidden = single;
  }

  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.remove();
    lightboxEl = null;
    galleryItems = [];
    document.body.style.overflow = "";
  }
  addEventListener("keydown", (e) => {
    if (!lightboxEl) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showSlide(galleryIndex - 1);
    else if (e.key === "ArrowRight") showSlide(galleryIndex + 1);
  });

  /* ---------- ambil daftar file (dipakai form & strip cookie) ---------- */
  let lastUrl = "";
  async function fetchFileList(url) {
    setLoading(true);
    renderSkeleton();
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...sessionCookieParams() })
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.success) {
        const msg = (data && data.message) || "Gagal mengambil file. Coba lagi.";
        if (data && data.needVerify) {
          /* link dikunci verifikasi: tampilkan strip cookie supaya user
             bisa tempel ndus lalu mencoba lagi tanpa meninggalkan hasil */
          lastUrl = url;
          hideResults();
          showResults();
          resultsTitle.textContent = "Link dikunci verifikasi TeraBox";
          resultsSub.textContent = "";
          rcNote.hidden = true;
          resultsBody.innerHTML = `<div class="empty-state"><i class="ph-bold ph-shield-warning"></i><p>${escapeText(msg)}</p></div>`;
          btnZip.hidden = true;
          cookieStrip.hidden = false;
          cookieStrip.querySelector("strong").textContent = data.cookieRejected
            ? "Cookie belum dikenali sebagai sesi login."
            : "Tempel cookie sesi login, lalu tekan Buka.";
          ndusInput.focus();
          setError(null);
          return;
        }
        hideResults();
        setError(msg);
        return;
      }

      lastUrl = url;
      lastData = data;
      shareToken = data.shareToken || null;
      renderResult(data);
      resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      hideResults();
      setError("Koneksi ke server terputus. Periksa jaringan Anda.");
    } finally {
      setLoading(false);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    setError(null);

    const url = input.value.trim();
    if (!url) return setError("Masukkan link TeraBox terlebih dahulu.");
    try {
      new URL(url);
    } catch {
      return setError("URL tidak valid. Pastikan diawali http:// atau https://");
    }
    fetchFileList(url);
  });

  /* ---------- strip cookie ndus (muncul saat ada video terkunci) ---------- */
  ndusInput.addEventListener("change", () => {
    try {
      const v = ndusInput.value.trim();
      if (v) localStorage.setItem("shareCookie", v);
      else localStorage.removeItem("shareCookie");
      localStorage.removeItem("ndus");
    } catch {}
  });
  btnApplyNdus.addEventListener("click", () => {
    try {
      const v = ndusInput.value.trim();
      if (v) localStorage.setItem("shareCookie", v);
    } catch {}
    if (lastUrl) fetchFileList(lastUrl);
  });

  /* salin perintah console: setiap tombol .btn-copy menyalin kode di
     dalam .code-copy induknya (dipakai snippet cookie & csrfToken) */
  document.querySelectorAll(".code-copy").forEach((box) => {
    const btn = box.querySelector(".btn-copy");
    const code = box.querySelector("code");
    if (!btn || !code) return;
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent.trim());
        btn.innerHTML = '<i class="ph-bold ph-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="ph ph-copy"></i>'; }, 1800);
      } catch {}
    });
  });

  input.addEventListener("input", () => setError(null));

  btnClear.addEventListener("click", () => {
    hideResults();
    lastData = null;
    shareToken = null;
    input.value = "";
    input.focus();
  });

  /* ---------- unduh semua (ZIP) ----------
     Link GET biasa => browser menangani download progresif native.
     shareToken selalu ada bila ada file yang bisa diunduh (server
     membuat sesi ringan sebagai fallback); tanpa itu, jangan diam-diam
     memakan klik — kembalikan label dan beri tahu. */
  btnZip.addEventListener("click", () => {
    if (!shareToken) {
      zipLabel.textContent = "Sesi kedaluwarsa, ambil ulang link";
      setTimeout(() => {
        const dlCount = lastData ? (lastData.files || []).filter((x) => x.finalDownloadUrl).length : 0;
        zipLabel.textContent = `Unduh Semua (${dlCount})`;
      }, 3000);
      return;
    }
    window.location.href = "/api/zip?d=" + encodeURIComponent(shareToken);
    zipLabel.textContent = "Diunduh...";
    setTimeout(() => {
      const dlCount = lastData ? (lastData.files || []).filter((x) => x.finalDownloadUrl).length : 0;
      zipLabel.textContent = `Unduh Semua (${dlCount})`;
    }, 4000);
  });

  /* ---------- modal legal (kebijakan privasi / ketentuan layanan) ---------- */
  const legalModal = $("legalModal");
  let legalPrevFocus = null;

  function openLegal(which) {
    if (!legalModal) return;
    legalPrevFocus = document.activeElement;
    legalModal.querySelectorAll(".legal__doc").forEach((d) => { d.hidden = d.id !== "legal-" + which; });
    legalModal.hidden = false;
    document.body.style.overflow = "hidden";
    legalModal.querySelector(".legal__panel").scrollTop = 0;
    legalModal.querySelector(".legal__close").focus();
  }
  function closeLegal() {
    if (!legalModal || legalModal.hidden) return;
    legalModal.hidden = true;
    document.body.style.overflow = "";
    if (legalPrevFocus) legalPrevFocus.focus();
  }
  if (legalModal) {
    legalModal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeLegal();
    });
    addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !legalModal.hidden) closeLegal();
    });
  }
  document.querySelectorAll(".footer-legal-link").forEach((btn) => {
    btn.addEventListener("click", () => openLegal(btn.dataset.legal));
  });

  /* ---------- perbaiki ikon yang hilang setelah pindah tab ----------
     Chromium kadang membuang font ikon saat tab di background, dan saat
     kembali glyph tidak digambar ulang. Triknya: toggle font-feature
     settings (memicu re-shaping glyph tanpa mengosongkan halaman) +
     minta browser memuat ulang font ikonnya. Tanpa reload, tanpa kedip. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    ["16px Phosphor", "16px 'Phosphor-Bold'"].forEach((f) => {
      document.fonts && document.fonts.load(f).catch(() => {});
    });
    const root = document.documentElement;
    root.classList.add("icon-repair");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("icon-repair")));
  });

  /* ---------- statistik pengunjung (first-party, real-time) ----------
     Session id acak dibuat dan disimpan di localStorage user; server
     hanya menghitung sesi aktif (heartbeat 30 dtk) dan total kunjungan.
     Tanpa cookie, tanpa IP, tanpa pihak ketiga. */
  (() => {
    const onlineEl = $("visitOnline");
    const totalEl = $("visitTotal");
    if (!onlineEl) return;
    let sid = "";
    try {
      sid = localStorage.getItem("vt_sid") || "";
      if (!sid) {
        sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-f0-9]/gi, "").slice(0, 32);
        if (sid.length < 8) sid = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
        localStorage.setItem("vt_sid", sid);
      }
    } catch { sid = ""; }
    async function ping() {
      try {
        const res = await fetch("/api/visit?sid=" + encodeURIComponent(sid), { cache: "no-store" });
        const d = await res.json();
        if (d && d.ok) {
          onlineEl.textContent = d.online;
          totalEl.textContent = Number(d.total).toLocaleString("id-ID");
        }
      } catch { /* server tak terjangkau: biarkan angka lama */ }
    }
    ping();
    setInterval(ping, 30000);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ping(); });
  })();

  /* ---------- paste button ---------- */
  btnPaste.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        input.value = text.trim();
        input.focus();
        setError(null);
      }
    } catch {
      /* clipboard ditolak browser: fokuskan saja biar user Ctrl+V */
      input.focus();
    }
  });

  /* ---------- background video: autoplay fallback ---------- */
  const bgVideo = $("bgVideo");
  bgVideo.addEventListener("canplay", () => {
    bgVideo.play().catch(() => {
      /* jika autoplay diblokir, video diam: tetap terlihat frame pertama */
    });
  });

  /* ---------- background video: jeda saat scroll ----------
    Frame video yang bergerak memaksa setiap permukaan blur di atasnya
    dihitung ulang per frame scroll. Saat user menggulir, video dijeda
    (frame terakhir tetap tampil) dan dilanjutkan ~250ms setelah berhenti.
    Terukur: ~29fps -> ~48fps pada mesin software-GPU. */
  let resumeTimer = null;
  addEventListener("scroll", () => {
    if (!bgVideo.paused) bgVideo.pause();
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      bgVideo.play().catch(() => {});
    }, 250);
  }, { passive: true });

  /* ---------- marquee domain ---------- */
  const DOMAINS = [
    "terabox.com", "1024terabox.com", "teraboxapp.com", "4funbox.com",
    "mirrobox.com", "nephobox.com", "momerybox.com", "tibibox.com",
    "freeterabox.com", "teraboxlink.com"
  ];
  const track = $("marqueeTrack");
  const pill = (d) =>
    `<span class="dom-pill"><i class="ph-bold ph-check-circle"></i>${d}</span>`;
  track.innerHTML = DOMAINS.map(pill).join("") + DOMAINS.map(pill).join("");

  /* ---------- FAQ accordion (buka/tutup smooth) ---------- */
  document.querySelectorAll(".faq-item").forEach((item) => {
    const btn = item.querySelector(".faq-q");
    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach((other) => {
        other.classList.remove("open");
        other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---------- scroll reveal (IntersectionObserver) ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      }
    },
    { threshold: 0.25 }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
})();
