/* ==========================================================================
   Krakow Insiders — site behavior
   Header show/hide, mobile menu, i18n (EN/PL), booking popup, video modal,
   intro widget, FAQ accordion, tour detail toggles, review slider, scroll
   reveals, form validation, lead submission to /api/send-lead, and the
   Tourvia-style GSAP animation layer (hero layers, SplitText titles,
   rolling counters, scrubbed step cards).
   ========================================================================== */

(function () {
  "use strict";

  var LEAD_ENDPOINT = "/api/send-lead";
  var LANG_STORAGE_KEY = "ki-lang";
  var WIDGET_STORAGE_KEY = "ki-intro-widget";

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined";

  /* ========================================================================
     i18n — English is captured from the markup, Polish comes from
     window.KI_TRANSLATIONS (js/translations.js).
     ======================================================================== */

  var enDictionary = {};
  var currentLang = "en";
  var titleSplits = [];

  function captureEnglish() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!(key in enDictionary)) {
        /* Keys flagged as HTML keep their markup (e.g. forced line breaks) */
        enDictionary[key] = el.hasAttribute("data-i18n-html")
          ? el.innerHTML
          : el.textContent;
      }
    });
    document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-label");
      if (!(key in enDictionary)) {
        enDictionary[key] = el.getAttribute("label") || "";
      }
    });
  }

  function translate(key) {
    if (currentLang === "en") return enDictionary[key];
    var dict = (window.KI_TRANSLATIONS || {})[currentLang] || {};
    return dict[key] !== undefined ? dict[key] : enDictionary[key];
  }

  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.setAttribute("lang", lang);

    /* Revert active SplitText instances before replacing their text nodes */
    teardownTitleAnimations();

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var value = translate(el.getAttribute("data-i18n"));
      if (value === undefined) return;
      if (el.hasAttribute("data-i18n-html")) {
        el.innerHTML = value;
      } else {
        el.textContent = value;
      }
    });

    document.querySelectorAll("[data-i18n-label]").forEach(function (el) {
      var value = translate(el.getAttribute("data-i18n-label"));
      if (value !== undefined) el.setAttribute("label", value);
    });

    document.querySelectorAll(".lang-switch__btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-lang") === lang);
    });

    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch (e) {
      /* storage unavailable (private mode) — language still switches for the session */
    }

    /* Re-measure any expanded detail panels: translated text changes their height */
    document.querySelectorAll(".tour-card__details.is-open").forEach(function (details) {
      details.style.maxHeight = details.scrollHeight + "px";
    });

    /* Re-split the (now translated) section titles */
    initTitleAnimations();

    /* Translated copy changes card heights — let scroll widgets re-measure */
    document.dispatchEvent(new Event("ki:langchange"));
  }

  function initLanguage() {
    captureEnglish();

    var saved = null;
    try {
      saved = localStorage.getItem(LANG_STORAGE_KEY);
    } catch (e) {
      saved = null;
    }
    if (saved === "pl") applyLanguage("pl");

    document.querySelectorAll(".lang-switch__btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var lang = btn.getAttribute("data-lang");
        if (lang !== currentLang) applyLanguage(lang);
      });
    });
  }

  /* ========================================================================
     Header — sticky, hides on scroll down, shows on scroll up or stop
     ======================================================================== */

  function initHeader() {
    var header = document.getElementById("header");
    if (!header) return;

    var lastY = window.scrollY;
    var stopTimer = null;
    var ticking = false;

    function update() {
      var y = window.scrollY;

      header.classList.toggle("is-scrolled", y > 24);

      var menuOpen = document.body.classList.contains("menu-open");
      if (!menuOpen) {
        if (y > lastY && y > 140) {
          header.classList.add("is-hidden");
        } else if (y < lastY) {
          header.classList.remove("is-hidden");
        }
      } else {
        header.classList.remove("is-hidden");
      }

      lastY = y;
      ticking = false;

      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(function () {
        header.classList.remove("is-hidden");
      }, 900);
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );

    update();
  }

  /* ========================================================================
     Mobile menu
     ======================================================================== */

  function initMobileMenu() {
    var burger = document.getElementById("burger");
    var menu = document.getElementById("mobileMenu");
    if (!burger || !menu) return;

    menu.querySelectorAll(".mobile-menu__nav a").forEach(function (link, i) {
      link.style.setProperty("--index", String(i));
    });

    function setOpen(open) {
      burger.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("is-open", open);
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      document.body.classList.toggle("menu-open", open);
      document.body.style.overflow = open ? "hidden" : "";
    }

    burger.addEventListener("click", function () {
      setOpen(!menu.classList.contains("is-open"));
    });

    menu.querySelectorAll("a[href^='#']").forEach(function (link) {
      link.addEventListener("click", function () {
        setOpen(false);
      });
    });

    menu.querySelectorAll("[data-open-booking]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setOpen(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("is-open")) setOpen(false);
    });
  }

  /* ========================================================================
     Modals — booking popup and video modal
     ======================================================================== */

  var openModal = null;

  function showModal(modal) {
    if (openModal) hideModal(openModal);
    openModal = modal;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    var firstField = modal.querySelector("input, select, textarea, video, button:not(.modal__close)");
    if (firstField && typeof firstField.focus === "function") {
      setTimeout(function () {
        firstField.focus({ preventScroll: true });
      }, 120);
    }
  }

  function hideModal(modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (openModal === modal) openModal = null;

    var video = modal.querySelector("video");
    if (video && !video.paused) video.pause();
  }

  function initModals() {
    var bookingModal = document.getElementById("bookingModal");
    var videoModal = document.getElementById("videoModal");
    var bookingType = document.getElementById("bf-type");

    document.querySelectorAll("[data-open-booking]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (bookingModal) {
          var form = bookingModal.querySelector("form");
          if (form) {
            form.dataset.sourceSection = btn.getAttribute("data-section") || "";
          }
          var type = btn.getAttribute("data-type");
          if (bookingType) {
            bookingType.value = type && optionExists(bookingType, type) ? type : "";
          }
          showModal(bookingModal);
        }
      });
    });

    document.querySelectorAll("[data-open-video]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (videoModal) showModal(videoModal);
      });
    });

    document.querySelectorAll("[data-close-modal]").forEach(function (el) {
      el.addEventListener("click", function () {
        var modal = el.closest(".modal");
        if (modal) hideModal(modal);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openModal) hideModal(openModal);
    });
  }

  function optionExists(select, value) {
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return true;
    }
    return false;
  }

  /* ========================================================================
     Intro video widget (desktop, bottom-right)
     ======================================================================== */

  function initIntroWidget() {
    var widget = document.getElementById("introWidget");
    if (!widget) return;

    var minBtn = document.getElementById("introWidgetMin");
    var closeBtn = document.getElementById("introWidgetClose");
    var bubble = document.getElementById("introWidgetBubble");

    var savedState = null;
    try {
      savedState = sessionStorage.getItem(WIDGET_STORAGE_KEY);
    } catch (e) {
      savedState = null;
    }
    if (savedState === "closed") widget.classList.add("is-closed");
    if (savedState === "minimized") widget.classList.add("is-minimized");

    function persist(state) {
      try {
        sessionStorage.setItem(WIDGET_STORAGE_KEY, state);
      } catch (e) {
        /* session storage unavailable — state is kept for the current view only */
      }
    }

    if (minBtn) {
      minBtn.addEventListener("click", function () {
        widget.classList.add("is-minimized");
        persist("minimized");
      });
    }

    if (bubble) {
      bubble.addEventListener("click", function () {
        widget.classList.remove("is-minimized");
        persist("open");
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        widget.classList.add("is-closed");
        persist("closed");
      });
    }

  }

  /* Floating elements (intro widget + booking button) stay hidden on the
     hero and appear once the second block reaches the viewport. */
  function initFloatingVisibility() {
    var widget = document.getElementById("introWidget");
    var floatBtn = document.getElementById("floatBooking");
    if (!widget && !floatBtn) return;

    var hero = document.querySelector(".hero");

    function updateVisibility() {
      var threshold = hero ? hero.offsetHeight - window.innerHeight * 0.25 : 400;
      var visible = window.scrollY > threshold;
      if (widget) widget.classList.toggle("is-visible", visible);
      if (floatBtn) floatBtn.classList.toggle("is-visible", visible);
    }

    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    updateVisibility();
  }

  /* ========================================================================
     FAQ accordion
     ======================================================================== */

  function initFaq() {
    document.querySelectorAll(".faq-item").forEach(function (item) {
      var button = item.querySelector(".faq-item__question");
      if (!button) return;

      button.addEventListener("click", function () {
        var isOpen = item.classList.contains("is-open");

        document.querySelectorAll(".faq-item.is-open").forEach(function (other) {
          other.classList.remove("is-open");
          var otherBtn = other.querySelector(".faq-item__question");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
        });

        if (!isOpen) {
          item.classList.add("is-open");
          button.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  /* ========================================================================
     Tour / service card "View Details" toggles
     ======================================================================== */

  function initDetailToggles() {
    document.querySelectorAll("[data-toggle-details]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var body = btn.closest(".package-card-bottom-block, .why-choose-card");
        if (!body) return;
        var details = body.querySelector(".tour-card__details");
        if (!details) return;

        var isOpen = details.classList.contains("is-open");
        if (isOpen) {
          details.style.maxHeight = "0px";
          details.classList.remove("is-open");
          btn.setAttribute("aria-expanded", "false");
        } else {
          details.classList.add("is-open");
          details.style.maxHeight = details.scrollHeight + "px";
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });

    /* Keep expanded panels correctly sized after resizes */
    window.addEventListener("resize", function () {
      document.querySelectorAll(".tour-card__details.is-open").forEach(function (details) {
        details.style.maxHeight = details.scrollHeight + "px";
      });
    });
  }

  /* ========================================================================
     Scroll reveal (IntersectionObserver; CSS handles the transition)
     ======================================================================== */

  function initReveals() {
    var elements = document.querySelectorAll("[data-reveal]");
    if (!elements.length) return;

    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (el) {
        el.classList.add("is-revealed");
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    elements.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ========================================================================
     Review slider — cross-fade with prev/next arrows
     ======================================================================== */

  /* Reviews carousel — video/text tabs, arrow navigation, progress bar.
     Slides by whole cards; the progress fill tracks scroll position. */
  function initReviews() {
    var section = document.getElementById("reviews");
    if (!section) return;

    var viewport = section.querySelector(".reviews-viewport");
    var tracks = Array.prototype.slice.call(section.querySelectorAll("[data-review-panel]"));
    var fill = section.querySelector("[data-review-progress]");
    var prev = section.querySelector("[data-review-prev]");
    var next = section.querySelector("[data-review-next]");
    var tabs = Array.prototype.slice.call(section.querySelectorAll("[data-review-tab]"));
    if (!viewport || !tracks.length) return;

    var index = 0;

    function activeTrack() {
      for (var i = 0; i < tracks.length; i++) {
        if (!tracks[i].hasAttribute("hidden")) return tracks[i];
      }
      return tracks[0];
    }

    function metrics(track) {
      var cards = track.children;
      if (!cards.length) return { step: 0, maxScroll: 0 };
      var style = getComputedStyle(track);
      var gap = parseFloat(style.columnGap || style.gap) || 0;
      var step = cards[0].getBoundingClientRect().width + gap;
      var maxScroll = Math.max(0, track.scrollWidth - viewport.clientWidth);
      return { step: step, maxScroll: maxScroll };
    }

    function apply() {
      var track = activeTrack();
      var m = metrics(track);
      var maxIndex = m.step > 0 ? Math.ceil(m.maxScroll / m.step) : 0;
      if (index > maxIndex) index = maxIndex;
      if (index < 0) index = 0;
      var offset = Math.min(index * m.step, m.maxScroll);
      track.style.transform = "translate3d(" + (-offset) + "px, 0, 0)";
      if (fill) fill.style.width = (m.maxScroll > 0 ? (offset / m.maxScroll) * 100 : 100) + "%";
      if (prev) prev.disabled = index <= 0;
      if (next) next.disabled = index >= maxIndex;
    }

    function go(dir) { index += dir; apply(); }

    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var name = tab.getAttribute("data-review-tab");
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        tracks.forEach(function (tr) {
          if (tr.getAttribute("data-review-panel") === name) tr.removeAttribute("hidden");
          else tr.setAttribute("hidden", "");
        });
        index = 0;
        apply();
      });
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(apply, 150);
    });
    window.addEventListener("load", apply);
    document.addEventListener("ki:langchange", function () { setTimeout(apply, 60); });

    apply();
  }

  /* Private Transfers — horizontal card carousel (arrows + progress bar). */
  function initTransferCarousel() {
    var section = document.getElementById("transfers");
    if (!section) return;

    var viewport = section.querySelector(".transfer-carousel__viewport");
    var track = section.querySelector("[data-transfer-track]");
    var fill = section.querySelector("[data-transfer-progress]");
    var prev = section.querySelector("[data-transfer-prev]");
    var next = section.querySelector("[data-transfer-next]");
    if (!viewport || !track || !track.children.length) return;

    var index = 0;

    function metrics() {
      var cards = track.children;
      var style = getComputedStyle(track);
      var gap = parseFloat(style.columnGap || style.gap) || 0;
      var step = cards[0].getBoundingClientRect().width + gap;
      var maxScroll = Math.max(0, track.scrollWidth - viewport.clientWidth);
      return { step: step, maxScroll: maxScroll };
    }

    function apply() {
      var m = metrics();
      var maxIndex = m.step > 0 ? Math.ceil(m.maxScroll / m.step) : 0;
      if (index > maxIndex) index = maxIndex;
      if (index < 0) index = 0;
      var offset = Math.min(index * m.step, m.maxScroll);
      track.style.transform = "translate3d(" + (-offset) + "px, 0, 0)";
      if (fill) fill.style.width = (m.maxScroll > 0 ? (offset / m.maxScroll) * 100 : 100) + "%";
      if (prev) prev.disabled = index <= 0;
      if (next) next.disabled = index >= maxIndex;
    }

    function go(dir) { index += dir; apply(); }

    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(apply, 150);
    });
    window.addEventListener("load", apply);
    document.addEventListener("ki:langchange", function () { setTimeout(apply, 60); });

    apply();
  }

  /* Video reviews play inline inside their tile — a play tap swaps the poster
     for a <video> element right in the section (no full-screen modal). */
  function initInlineReviewVideos() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-play-inline]"));
    if (!buttons.length) return;

    var PLAY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11.14-6.86a1 1 0 0 0 0-1.72L9.52 4.28A1 1 0 0 0 8 5.14Z"/></svg>';
    var PAUSE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5h3.2v14H8zM12.8 5H16v14h-3.2z"/></svg>';

    function setBtnState(btn, playing) {
      btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
      var who = btn.getAttribute("data-reviewer") || "";
      btn.setAttribute("aria-label", (playing ? "Pause" : "Play") + " video review" + (who ? " from " + who : ""));
    }

    /* Pause every playing review video except an optional one to keep going. */
    function pauseAll(except) {
      document.querySelectorAll(".review-tile__video").forEach(function (v) {
        if (v !== except && !v.paused) v.pause();
      });
    }

    buttons.forEach(function (btn) {
      /* Stash the reviewer name from the original aria-label before we swap icons */
      var m = (btn.getAttribute("aria-label") || "").match(/from (.+)$/);
      if (m) btn.setAttribute("data-reviewer", m[1]);

      btn.addEventListener("click", function () {
        var media = btn.closest("[data-video-tile]");
        if (!media) return;

        var video = media.querySelector(".review-tile__video");
        if (video) {
          /* Toggle the existing video — the button stays exactly in place */
          if (video.paused) { pauseAll(video); video.play(); }
          else { video.pause(); }
          return;
        }

        pauseAll();
        video = document.createElement("video");
        video.className = "review-tile__video";
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.preload = "auto";
        [["media/hero-card.webm", "video/webm"], ["media/hero-card.mp4", "video/mp4"]].forEach(function (s) {
          var source = document.createElement("source");
          source.src = s[0];
          source.type = s[1];
          video.appendChild(source);
        });
        media.appendChild(video);
        media.classList.add("is-playing");

        video.addEventListener("play", function () { setBtnState(btn, true); });
        video.addEventListener("pause", function () { setBtnState(btn, false); });
        video.addEventListener("ended", function () { setBtnState(btn, false); });

        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      });
    });

    /* Stop playback when switching between the video and text tabs */
    document.querySelectorAll("[data-review-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { pauseAll(); });
    });
  }

  /* ========================================================================
     GSAP animation layer (Tourvia-style motion)
     ======================================================================== */

  function initHeroAnimation() {
    if (!hasGsap || prefersReducedMotion) return;

    var sky = document.querySelector("[data-anim='hero-sky']");
    var title = document.querySelector("[data-anim='hero-title']");
    var castle = document.querySelector("[data-anim='hero-castle']");
    var content = document.querySelector("[data-anim='hero-content']");
    if (!sky || !title || !content) return;

    /* The castle cutout must move in lockstep with the sky layer so the
       two copies of the photo stay pixel-aligned. */
    var bgLayers = castle ? [sky, castle] : [sky];

    /* Load-in timeline — replicates the template's Webflow interaction:
       sky scales 1.1 -> 1; mountain rises from 20% with scale + fade;
       the giant title fades in at ~0.9s while its characters (SplitText
       type "chars") come up from y:30% with a 0.05s stagger; the content
       block follows at ~1.2s from y:20%. */
    var tl = gsap.timeline({ defaults: { ease: "power2.out" } });

    tl.fromTo(bgLayers, { scale: 1.1 }, { scale: 1, duration: 1.8 }, 0);

    var chars = null;
    if (window.SplitText) {
      try {
        var split = new SplitText(title, { type: "chars", charsClass: "hero-title-char" });
        chars = split.chars;
      } catch (e) {
        chars = null;
      }
    }

    if (chars && chars.length) {
      tl.fromTo(title, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.inOut" }, 0.9)
        .fromTo(
          chars,
          { yPercent: 30, opacity: 0 },
          { yPercent: 0, opacity: 1, duration: 0.5, stagger: 0.05, ease: "power1.inOut" },
          0.9
        );
    } else {
      tl.fromTo(title, { opacity: 0, yPercent: 18 }, { opacity: 1, yPercent: 0, duration: 1.1 }, 0.9);
    }

    tl.fromTo(content, { yPercent: 20, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, ease: "power1.inOut" }, 1.2);

    /* Scroll behavior like the template: the giant title sinks down and
       hides behind the castle cutout (which sits above it in z-order),
       re-emerging when scrolling back up — scrub keeps it reversible.
       The letters over the open sky (left side, no castle to hide behind)
       dissolve gently in the last stretch of the movement instead. */
    if (window.ScrollTrigger) {
      var sink = gsap.timeline({
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "70% top",
          scrub: true
        }
      });
      sink.to(title, { y: "52vh", ease: "none", duration: 1 }, 0)
          .to(title, { opacity: 0, ease: "none", duration: 0.35 }, 0.65);
    }
  }

  function teardownTitleAnimations() {
    titleSplits.forEach(function (entry) {
      if (entry.trigger && entry.trigger.kill) entry.trigger.kill();
      if (entry.split && entry.split.revert) entry.split.revert();
    });
    titleSplits = [];
  }

  function initTitleAnimations() {
    if (!hasGsap || !window.SplitText || !window.ScrollTrigger || prefersReducedMotion) return;

    document.querySelectorAll(".section-title-animation").forEach(function (block) {
      var target = block.querySelector("h2, p, .heading-style-h3, .heading-style-h4");
      if (!target) return;

      var split;
      try {
        split = new SplitText(target, { type: "lines", linesClass: "split-line" });
      } catch (e) {
        return;
      }

      /* Wrap each line in an overflow mask so lines rise into view */
      split.lines.forEach(function (line) {
        var mask = document.createElement("span");
        mask.className = "split-line-mask";
        line.parentNode.insertBefore(mask, line);
        mask.appendChild(line);
      });

      var tween = gsap.fromTo(
        split.lines,
        { yPercent: 110 },
        {
          yPercent: 0,
          duration: 0.9,
          stagger: 0.09,
          ease: "power3.out",
          scrollTrigger: {
            trigger: block,
            start: "top 85%",
            once: true
          }
        }
      );

      titleSplits.push({ split: split, trigger: tween.scrollTrigger });
    });
  }

  function initCounters() {
    var counters = document.querySelectorAll("[data-count-to]");
    if (!counters.length) return;

    if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
      counters.forEach(function (el) {
        el.textContent = el.getAttribute("data-count-to");
      });
      return;
    }

    counters.forEach(function (el) {
      var target = parseInt(el.getAttribute("data-count-to"), 10) || 0;
      var state = { value: 0 };
      gsap.to(state, {
        value: target,
        duration: 1.8,
        ease: "power2.out",
        snap: { value: 1 },
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          once: true
        },
        onUpdate: function () {
          el.textContent = String(Math.round(state.value));
        }
      });
    });
  }

  /* "How It Works": a vertical list of numbered steps linked by a rail. As the
     section scrolls through the viewport the rail fills from the top and each
     number circle turns solid the moment the rail reaches it. Falls back to a
     fully-filled list when motion is reduced or GSAP is unavailable. */
  function initStepScrub() {
    var block = document.querySelector("[data-step-scrub]");
    if (!block) return;

    var cards = Array.prototype.slice.call(block.querySelectorAll(".why-choose-card"));
    if (!cards.length) return;

    /* Size the rail to run only from the first circle centre to the last one,
       so it never trails below the final step's text. */
    function measureRail() {
      var first = cards[0].querySelector(".why-choose-card-icon-block");
      var last = cards[cards.length - 1].querySelector(".why-choose-card-icon-block");
      if (!first || !last) return;
      var fr = first.getBoundingClientRect();
      var lr = last.getBoundingClientRect();
      var h = (lr.top + lr.height / 2) - (fr.top + fr.height / 2);
      if (h > 0) block.style.setProperty("--steps-rail", h + "px");
    }
    measureRail();
    window.addEventListener("load", measureRail);
    window.addEventListener("resize", measureRail);
    document.addEventListener("ki:langchange", measureRail);

    function fillAll() {
      block.style.setProperty("--steps-fill", "1");
      cards.forEach(function (card) { card.classList.add("is-filled"); });
    }

    if (!hasGsap || !window.ScrollTrigger || prefersReducedMotion) {
      fillAll();
      return;
    }

    /* Circle i sits at fraction i/(n-1) along the rail, so it activates the
       moment the rail's fill height passes that point. */
    function render(progress) {
      block.style.setProperty("--steps-fill", progress.toFixed(4));
      var n = cards.length;
      cards.forEach(function (card, i) {
        var point = n > 1 ? i / (n - 1) : 0;
        card.classList.toggle("is-filled", progress >= point - 0.001);
      });
    }

    var st = ScrollTrigger.create({
      trigger: block,
      start: "top 78%",
      end: "bottom 62%",
      onUpdate: function (self) { render(self.progress); },
      onRefresh: function (self) { render(self.progress); }
    });

    function onRemeasure() { ScrollTrigger.refresh(); }
    document.addEventListener("ki:langchange", onRemeasure);

    render(st.progress || 0);
  }

  /* ========================================================================
     Forms — validation and lead submission
     ======================================================================== */

  function setFieldError(input, hasError) {
    var field = input.closest(".form-field");
    if (field) field.classList.toggle("has-error", hasError);
  }

  function validateForm(form) {
    var valid = true;

    var name = form.elements.name;
    var phone = form.elements.phone;
    var email = form.elements.email;
    var type = form.elements.type;
    var date = form.elements.date;
    var people = form.elements.people;
    var privacy = form.elements.privacy;

    var nameOk = name.value.trim().length >= 2;
    setFieldError(name, !nameOk);

    var phoneOk = /^[+\d][\d\s\-()]{5,19}$/.test(phone.value.trim());
    setFieldError(phone, !phoneOk);

    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
    setFieldError(email, !emailOk);

    var typeOk = type.value !== "";
    setFieldError(type, !typeOk);

    var dateOk = date.value !== "";
    setFieldError(date, !dateOk);

    var peopleValue = parseInt(people.value, 10);
    var peopleOk = !isNaN(peopleValue) && peopleValue >= 1 && peopleValue <= 60;
    setFieldError(people, !peopleOk);

    var privacyOk = privacy.checked;
    setFieldError(privacy, !privacyOk);

    valid = nameOk && phoneOk && emailOk && typeOk && dateOk && peopleOk && privacyOk;

    if (!valid) {
      var firstError = form.querySelector(".form-field.has-error input, .form-field.has-error select");
      if (firstError) firstError.focus({ preventScroll: false });
    }

    return valid;
  }

  function buildPayload(form) {
    return {
      source: "Krakow Insiders Website",
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      type: form.elements.type.value,
      date: form.elements.date.value,
      people: form.elements.people.value,
      message: form.elements.message.value.trim(),
      section: form.dataset.sourceSection || (form.id === "contactForm" ? "Contacts section" : "Booking popup"),
      page: window.location.href,
      lang: currentLang,
      submittedAt: new Date().toISOString()
    };
  }

  function initLeadForm(form) {
    if (!form) return;

    ["input", "change"].forEach(function (evt) {
      form.addEventListener(evt, function (e) {
        if (e.target && e.target.closest) {
          var field = e.target.closest(".form-field");
          if (field) field.classList.remove("has-error");
        }
        form.classList.remove("is-error");
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      form.classList.remove("is-success", "is-error");

      if (!validateForm(form)) return;

      form.classList.add("is-sending");

      fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form))
      })
        .then(function (response) {
          if (!response.ok) throw new Error("Lead endpoint responded with " + response.status);
          return response;
        })
        .then(function () {
          form.classList.remove("is-sending");
          form.classList.add("is-success");
          form.reset();
        })
        .catch(function () {
          form.classList.remove("is-sending");
          form.classList.add("is-error");
        });
    });
  }

  /* ========================================================================
     Init
     ======================================================================== */

  document.addEventListener("DOMContentLoaded", function () {
    if (hasGsap && window.ScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
      if (window.SplitText) gsap.registerPlugin(SplitText);
    }

    initLanguage();
    initHeader();
    initMobileMenu();
    initModals();
    initIntroWidget();
    initFloatingVisibility();
    initFaq();
    initDetailToggles();
    initReveals();
    initReviews();
    initTransferCarousel();
    initInlineReviewVideos();
    initLeadForm(document.getElementById("contactForm"));
    initLeadForm(document.getElementById("bookingForm"));

    initHeroAnimation();
    if (currentLang === "en") {
      /* applyLanguage already ran initTitleAnimations for non-EN sessions */
      initTitleAnimations();
    }
    initCounters();
    initStepScrub();
  });
})();
