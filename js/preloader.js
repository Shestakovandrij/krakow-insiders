/* ============================================================
   Krakow Insiders — Preloader ("Insider Journey Begins")
   Vanilla + GSAP (reuses the site's js/vendor/gsap.min.js).
   Plays once per session, ~3.2s, then reveals the site.
   ============================================================ */
(function () {
  var KEY = "ki_preloader_shown";
  var root = document.getElementById("ki-preloader");
  if (!root || typeof window.gsap === "undefined") {
    // no overlay or GSAP missing → make sure nothing blocks the site
    if (root && root.parentNode) root.parentNode.removeChild(root);
    return;
  }

  var q = function (s) { return root.querySelectorAll(s); };
  var one = function (s) { return root.querySelector(s); };

  var prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  function done() {
    document.body.style.overflow = prevOverflow;
    try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    root.style.pointerEvents = "none";
    root.style.visibility = "hidden";
    if (root.parentNode) root.parentNode.removeChild(root);
    // let the site recalc scroll-based animations now that layout is final
    if (window.ScrollTrigger && typeof window.ScrollTrigger.refresh === "function") {
      window.ScrollTrigger.refresh();
    }
    document.dispatchEvent(new CustomEvent("ki:preloader-done"));
  }

  // already seen this session → skip entirely
  if (sessionStorage.getItem(KEY)) {
    document.body.style.overflow = prevOverflow;
    if (root.parentNode) root.parentNode.removeChild(root);
    return;
  }

  // reduced motion → quiet, quick fade
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.set(one(".pl-logo"), { clipPath: "inset(0)", opacity: 1 });
    gsap.set(one(".pl-message"), { opacity: 1 });
    gsap.set(one(".pl-fill"), { width: "100%" });
    var n0 = one(".pl-num"); if (n0) n0.textContent = "100";
    gsap.to(root, { opacity: 0, duration: 0.5, delay: 0.5, ease: "power2.out", onComplete: done });
    return;
  }

  var numEl = one(".pl-num");
  var statusEl = one(".pl-status");
  var fillEl = one(".pl-fill");
  var statuses = [
    "Planning your route",
    "Preparing local insights",
    "Arranging private comfort",
    "Opening Kraków for you"
  ];
  var counter = { val: 0 };

  var tl = gsap.timeline({ defaults: { ease: "power3.out" }, onComplete: done });

  // 1 · background settles in
  tl.fromTo(one(".pl-glow"), { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 1.3, ease: "power2.out" }, 0)
    .fromTo(one(".pl-bg"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0);

  // 2 · intro label
  tl.fromTo(one(".pl-label"), { opacity: 0, y: 12, filter: "blur(8px)" },
                              { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.5 }, 0.1);

  // 3 · route line + travelling marker
  tl.fromTo(one(".pl-route-line"), { scaleX: 0 }, { scaleX: 1, duration: 0.65, ease: "power2.inOut" }, 0.28)
    .set(one(".pl-route-dot"), { opacity: 1 }, 0.3)
    .fromTo(one(".pl-route-dot"), { left: "0%" }, { left: "100%", duration: 0.65, ease: "power2.inOut" }, 0.3)
    .to(one(".pl-route-dot"), { opacity: 0, duration: 0.3 }, 0.92);

  // 4 · logo reveal (centre-out clip-path)
  tl.fromTo(one(".pl-logo"),
     { clipPath: "inset(0% 50% 0% 50%)", opacity: 0, scale: 1.05 },
     { clipPath: "inset(0% 0% 0% 0%)", opacity: 1, scale: 1, duration: 0.8, ease: "power3.out" }, 0.5);

  // 5 · light sweep
  tl.fromTo(one(".pl-sweep"), { x: "-140%", opacity: 0 }, { x: "140%", opacity: 1, duration: 0.85, ease: "power2.inOut" }, 0.95)
    .to(one(".pl-sweep"), { opacity: 0, duration: 0.2 }, 1.75);

  // 5b · insider cards stagger
  tl.fromTo(q(".pl-card"),
     { opacity: 0, y: 16, scale: 0.94, filter: "blur(10px)" },
     { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.55, stagger: 0.1 }, 0.85);

  // 6 · main message
  tl.fromTo(one(".pl-message"), { opacity: 0, y: 14, filter: "blur(8px)" },
                                { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.55 }, 1.25);

  // 6b · rotating status
  tl.fromTo(one(".pl-status"), { opacity: 0, y: 8, filter: "blur(6px)" },
                               { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.3 }, 1.35);
  for (var i = 1; i < statuses.length; i++) {
    (function (txt, at) {
      tl.to(one(".pl-status"), { opacity: 0, y: -6, filter: "blur(6px)", duration: 0.18 }, at)
        .add(function () { if (statusEl) statusEl.textContent = txt; }, at + 0.18)
        .fromTo(one(".pl-status"), { opacity: 0, y: 8, filter: "blur(6px)" },
                                   { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.22 }, at + 0.19);
    })(statuses[i], 1.35 + i * 0.3);
  }

  // 7 · premium progress counter (slow → accelerates to 100)
  tl.to(counter, {
    val: 100, duration: 1.42, ease: "power2.in",
    onUpdate: function () {
      if (numEl) numEl.textContent = Math.round(counter.val);
      if (fillEl) fillEl.style.width = counter.val + "%";
    }
  }, 0.82);

  // 8 · working state out, final line in
  tl.to([one(".pl-content"), one(".pl-progress")], { opacity: 0, y: -10, filter: "blur(6px)", duration: 0.4 }, 2.28)
    .fromTo(one(".pl-final"), { opacity: 0, y: 12, filter: "blur(8px)" },
                              { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.4 }, 2.34)
    .to(one(".pl-final"), { opacity: 0, duration: 0.3 }, 2.86);

  // 9 · curtain reveal upward → hand off to the site
  tl.to(root, {
    clipPath: "inset(0% 0% 100% 0%)", duration: 0.62, ease: "power4.inOut",
    onStart: function () { root.style.pointerEvents = "none"; document.body.style.overflow = prevOverflow; }
  }, 2.6);
})();
