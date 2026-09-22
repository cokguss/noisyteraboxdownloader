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

  const empty = $("resultEmpty");
  const skeleton = $("resultSkeleton");
  const card = $("resultCard");
  const rcList = $("rcList");
  const rcNote = $("rcNote");

  /* ---------- state helpers ---------- */
  const show = (el) => (el.hidden = false);
  const hide = (el) => (el.hidden = true);

  function setState(state) {
    hide(empty);
    hide(skeleton);
    hide(card);
    if (state === "empty") show(empty);
    if (state === "loading") show(skeleton);
    if (state === "done") show(card);
  }

  function setError(msg) {
    if (!msg) {
      hide(formError);
      inputRow.classList.remove("is-error");
      return;
    }
    formError.innerHTML = `<i class="ph-bold ph-warning-circle"></i> ${msg}`;
    show(formError);
    inputRow.classList.add("is-error");
  }

  function setLoading(on) {
    btnSubmit.disabled = on;
    btnLabel.textContent = on ? "Memproses..." : "Ambil File";
    btnIcon.className = on ? "spin" : "ph-bold ph-arrow-down";
  }

  /* file icon per ekstensi (Phosphor, satu famili) */
  function iconFor(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (["mp4", "mkv", "avi", "mov", "webm", "flv"].includes(ext)) return "ph-file-video";
    if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) return "ph-file-audio";
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "ph-file-image";
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "ph-file-zip";
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "ph-file-text";
    return "ph-file";
  }

  const looksLikeVideo = (name) =>
    /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(name || "");

  /* ---------- submit ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError(null);

    const url = input.value.trim();
    if (!url) return setError("Masukkan link TeraBox terlebih dahulu.");
    try {
      new URL(url);
    } catch {
      return setError("URL tidak valid. Pastikan diawali http:// atau https://");
    }

    setLoading(true);
    setState("loading");

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data || !data.success) {
        const msg = (data && data.message) || "Gagal mengambil file. Coba lagi.";
        setState("empty");
        setError(msg);
        return;
      }

      renderResult(data);
    } catch {
      setState("empty");
      setError("Koneksi ke server terputus. Periksa jaringan Anda.");
    } finally {
      setLoading(false);
    }
  });

  input.addEventListener("input", () => setError(null));

  function renderResult(d) {
    const files = d.files || [];
    rcList.innerHTML = "";

    files.forEach((f) => {
      const name = f.fileName || "file";
      const size = f.fileSize ? `Ukuran ${f.fileSize}` : "Ukuran tidak dilaporkan";
      const isVideo = looksLikeVideo(name) && f.streamUrl;

      const item = document.createElement("div");
      item.className = "rc-item";

      const head = document.createElement("div");
      head.className = "rc-head";
      head.innerHTML =
        `<span class="rc-icon"><i class="ph-bold ${iconFor(name)}"></i></span>` +
        `<div class="rc-meta">` +
        `<p class="rc-name" title="${escapeAttr(name)}">${escapeText(name)}</p>` +
        `<p class="rc-size">${escapeText(size)}</p>` +
        `</div>`;
      item.appendChild(head);

      if (isVideo) {
        const prev = document.createElement("div");
        prev.className = "rc-preview";
        prev.innerHTML = `<video controls preload="metadata" src="${escapeAttr(f.streamUrl)}"></video>`;
        item.appendChild(prev);
      }

      const actions = document.createElement("div");
      actions.className = "rc-actions";
      const dl = document.createElement("a");
      dl.className = "btn-primary rc-btn";
      dl.href = f.finalDownloadUrl;
      dl.target = "_blank";
      dl.rel = "noopener";
      dl.innerHTML = `<span class="btn-label">Unduh</span><i class="ph-bold ph-download-simple"></i>`;
      actions.appendChild(dl);

      if (f.streamUrl) {
        const st = document.createElement("a");
        st.className = "btn-ghost rc-btn";
        st.href = f.streamUrl;
        st.target = "_blank";
        st.rel = "noopener";
        st.innerHTML = `<span class="btn-label">Stream</span><i class="ph ph-play"></i>`;
        actions.appendChild(st);
      }
      item.appendChild(actions);
      rcList.appendChild(item);
    });

    if (d.downloadsRemaining !== undefined && d.downloadsRemaining !== null) {
      rcNote.innerHTML = `Sisa kuota pengambilan pada sesi ini: <strong>${d.downloadsRemaining}</strong>`;
      show(rcNote);
    } else {
      hide(rcNote);
    }

    setState("done");
    if (window.matchMedia("(max-width: 900px)").matches) {
      $("resultPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const escapeText = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

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

  setState("empty");
})();
