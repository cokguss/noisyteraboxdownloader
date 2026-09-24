/* Preloader "kotak unduhan": isian kotak naik 0-100% eased, angka
   persen ikut, lalu fade & hapus dari DOM. Minimum tampil 1.5s biar
   tidak "kedip"; guard 5s tidak pernah memblokir halaman. */
(function () {
  "use strict";

  var loader = document.getElementById("pageLoader");
  if (!loader) return;

  var fill = document.getElementById("loaderFill");
  var count = document.getElementById("loaderCount");
  var RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var done = false;
  var progressDone = false;
  var pageLoaded = false;
  var startedAt = Date.now();
  var MIN_SHOW = RM ? 250 : 1500;

  function finish() {
    if (done) return;
    done = true;
    loader.classList.add("is-done");
    loader.style.pointerEvents = "none";
    setTimeout(function () {
      if (loader.parentNode) loader.parentNode.removeChild(loader);
    }, 680);
  }

  function maybe() {
    var elapsed = Date.now() - startedAt;
    if (progressDone && pageLoaded) {
      if (elapsed >= MIN_SHOW) {
        finish();
      } else {
        setTimeout(maybe, MIN_SHOW - elapsed + 40);
      }
    }
  }

  function tick(startTs, ts) {
    var p = Math.min(1, (ts - startTs) / 1400);
    var eased = 1 - Math.pow(1 - p, 3);
    var val = Math.round(eased * 100);
    if (fill) fill.style.height = val + "%";
    if (count) count.textContent = String(val).padStart(2, "0");
    if (p < 1) {
      requestAnimationFrame(function (t) { tick(startTs, t); });
    } else {
      progressDone = true;
      maybe();
    }
  }

  if (RM) {
    if (fill) fill.style.height = "100%";
    if (count) count.textContent = "100";
    progressDone = true;
  } else {
    requestAnimationFrame(function (t) { tick(t, t); });
  }

  if (document.readyState === "complete") {
    pageLoaded = true;
  } else {
    window.addEventListener("load", function () {
      pageLoaded = true;
      maybe();
    });
  }

  /* guard: jangan pernah menahan halaman lebih dari ~5 detik */
  setTimeout(function () {
    progressDone = true;
    pageLoaded = true;
    finish();
  }, 5000);
})();
