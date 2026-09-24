/* Asisten AI mengambang — menjawab pertanyaan seputar website.
   API qwen bersifat single-turn, jadi konteks situs + riwayat singkat
   ikut dikirim di tiap prompt. */
(() => {
  "use strict";

  const API = "https://api.ikyyxd.my.id/ai/qwen?prompt=";

  const CONTEXT = [
    "Kamu adalah asisten AI resmi situs 'Noisy TeraBox Downloader' (noisy terabox downloader).",
    "Jawab dalam bahasa Indonesia yang santai, singkat, dan ramah (maks ~120 kata), kecuali user bertanya dalam bahasa lain.",
    "Fakta situs:",
    "- Gratis, tanpa login, tanpa aplikasi. Cara pakai: tempel link berbagi TeraBox (bentuk /s/xxx atau /sharing/link?surl=xxx, dari domain terabox.com, 1024terabox, teraboxapp, 4funbox, mirrobox, nephobox, momerybox, tibibox, freeterabox, teraboxlink, dm.terabox.app, dll), tekan 'Ambil File', lalu Unduh / Stream / Unduh Semua (zip).",
    "- Mendukung folder berisi video, foto, dan file lain. Foto diunduh sebagai rendisi kualitas tertinggi yang publik.",
    "- Video kadang 'Terkunci' karena TeraBox memasang verifikasi; solusinya user menempel cookie sesi login (harus berisi BDUSS; nilai ndus saja tidak cukup) di kolom yang muncul, lalu ambil ulang link. Cookie disimpan hanya di localStorage browser user.",
    "- Cara mengambil cookie & csrfToken (ajarkan langkah ini bila ditanya soal token/verifikasi): buka terabox.com yang sudah login, tekan inspect element / Developer Tools (F12). (a) Cookie: tab Application/Storage > Cookies > pilih https://terabox.com, salin BDUSS, ndus, dan csrfToken. (b) Atau di tab Network pilih filter Doc, klik request halaman, lihat header Cookie. (c) Atau cepat lewat Console: copy(document.cookie) untuk semua cookie, dan copy((document.cookie.match(/csrfToken=([^;]+)/)||[])[1]) khusus csrfToken.",
    "- Format penggabungan di kolom cookie situs: BDUSS=...; ndus=...; csrfToken=...",
    "- Ada tombol 'Stream' untuk memutar video via HLS tanpa unduh.",
    "- Link unduhan berlaku beberapa jam (token upstream).",
    "- Privasi: tidak menyimpan file, tanpa pelacak/iklan/analitik; hanya memetakan link ke alamat unduh resmi TeraBox.",
    "- Developer: Noisy (Telegram @noisy02, github.com/cokguss). Support: BloodSkill (Telegram @bloodskil2), pengembang bot Telegram XtremeUbot (@qbxy_bot).",
    "- Halaman punya Kebijakan Privasi dan Ketentuan Layanan di footer.",
    "Jika ditanya hal di luar topik situs/TeraBox secara umum, arahkan kembali dengan sopan. Jangan mengarang fitur."
  ].join("\n");

  const fab = document.getElementById("chatFab");
  const widget = document.getElementById("chatWidget");
  const panel = widget.querySelector(".chat__panel");
  const log = document.getElementById("chatLog");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const send = document.getElementById("chatSend");
  const closeBtn = document.getElementById("chatClose");

  const history = []; // {role:'user'|'bot', text}

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

  function bubble(role, text) {
    const div = document.createElement("div");
    div.className = "chat__msg chat__msg--" + (role === "user" ? "me" : "bot");
    div.innerHTML = `<p>${nl2br(text)}</p>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  function typing(on) {
    let el = log.querySelector(".chat__typing");
    if (on) {
      if (!el) {
        el = document.createElement("div");
        el.className = "chat__msg chat__msg--bot chat__typing";
        el.innerHTML = "<p><i></i><i></i><i></i></p>";
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
      }
    } else if (el) el.remove();
  }

  async function ask(text) {
    bubble("user", text);
    history.push({ role: "user", text });
    typing(true);
    send.disabled = true;

    const tail = history.slice(-6).map((m) => `${m.role === "user" ? "User" : "Asisten"}: ${m.text}`).join("\n");
    const prompt = `${CONTEXT}\n\nPercakapan terakhir:\n${tail}\n\nUser: ${text}\n\nAsisten:`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(API + encodeURIComponent(prompt), { signal: ctrl.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => null);
      const answer = data && data.status && data.result && String(data.result.response || "").trim();
      if (!answer) throw new Error("kosong");
      const clean = answer.replace(/^Asisten:\s*/i, "");
      bubble("bot", clean);
      history.push({ role: "bot", text: clean });
    } catch {
      bubble("bot", "Maaf, asisten sedang tidak dapat dihubungi. Coba lagi sebentar ya.");
    } finally {
      typing(false);
      send.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    ask(text);
  });

  function openChat() {
    widget.hidden = false;
    fab.classList.add("is-active");
    requestAnimationFrame(() => panel.classList.add("is-in"));
    input.focus();
  }
  function closeChat() {
    panel.classList.remove("is-in");
    fab.classList.remove("is-active");
    setTimeout(() => { widget.hidden = true; }, 260);
  }

  fab.addEventListener("click", () => (widget.hidden ? openChat() : closeChat()));
  closeBtn.addEventListener("click", closeChat);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !widget.hidden) closeChat();
  });
})();
