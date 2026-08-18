/* ==========================================================================
   Krakow Insiders — content rendering

   Tours and reviews used to live as hand-written markup in index.html. They
   now live in JSON that the panel edits, and this file turns that JSON back
   into exactly the same markup.

   The important detail is what it does NOT change: every card still carries
   the same data-i18n keys as before, and the Polish strings are pushed into
   window.KI_TRANSLATIONS before the site boots. So the language switch, the
   WhatsApp link builder, the scroll reveals and the review slider all keep
   working through the machinery that was already there — none of them needs
   to know the content arrived over the network.

   script.js waits on window.KI_CONTENT_READY before initialising, so nothing
   ever runs against a half-built section.
   ========================================================================== */

(function () {
  "use strict";

  var ENDPOINT = "/api/content";
  var FALLBACK = "data/content.json";
  var LANGS = ["en", "pl"];

  var ARROW_ICONS =
    '<span class="primary-button-icon-block"><span class="button-icon-wrapper">' +
    '<img src="images/arrow-blue.svg" alt="" class="button-icon" width="16" height="13">' +
    '<img src="images/arrow-white.svg" alt="" class="button-icon" width="16" height="13">' +
    "</span></span>";

  /* ------------------------------------------------------------------------
     Translation registration

     English is read out of the markup by script.js, so only Polish has to be
     registered here — under the same key the rendered element carries.
     ------------------------------------------------------------------------ */

  function dictionary() {
    if (!window.KI_TRANSLATIONS) window.KI_TRANSLATIONS = {};
    if (!window.KI_TRANSLATIONS.pl) window.KI_TRANSLATIONS.pl = {};
    return window.KI_TRANSLATIONS.pl;
  }

  function registerPolish(key, value) {
    if (typeof value === "string" && value) dictionary()[key] = value;
  }

  /* ------------------------------------------------------------------------
     Element helpers
     ------------------------------------------------------------------------ */

  function el(tag, className, attributes) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attributes) {
      Object.keys(attributes).forEach(function (name) {
        if (attributes[name] !== null && attributes[name] !== undefined) {
          node.setAttribute(name, attributes[name]);
        }
      });
    }
    return node;
  }

  /* Text always goes in as textContent, never innerHTML: the panel is the
     only writer today, but content that renders as markup would turn one
     careless paste into a scripting hole on the public page. */
  function textNode(tag, className, key, value, attributes) {
    var node = el(tag, className, attributes);
    if (key) node.setAttribute("data-i18n", key);
    node.textContent = value || "";
    return node;
  }

  function lang(item, code) {
    return (item && item[code]) || {};
  }

  /* ------------------------------------------------------------------------
     Tours
     ------------------------------------------------------------------------ */

  function tourKey(tour, field) {
    return "tours." + tour.id + "." + field;
  }

  function registerTour(tour) {
    var pl = lang(tour, "pl");
    registerPolish(tourKey(tour, "tag"), pl.tag);
    registerPolish(tourKey(tour, "title"), pl.title);
    registerPolish(tourKey(tour, "desc"), pl.desc);
  }

  function priceBlock(tour) {
    if (!tour.price || !tour.price.amount) return null;

    var block = el("div", "destination-card-price");
    if (tour.price.from) {
      block.appendChild(textNode("span", "destination-card-price__from", "tours.priceFrom", "from"));
    }
    block.appendChild(textNode("span", "destination-card-price__amount", null, tour.price.amount));

    if (tour.price.unit === "person") {
      block.appendChild(textNode("span", "destination-card-price__unit", "tours.priceUnit", "/ person"));
    } else if (tour.price.unit === "personDay") {
      block.appendChild(textNode("span", "destination-card-price__unit", "tours.priceUnitDay", "/ person, full day"));
    }
    return block;
  }

  function bookingButton(tour) {
    var isCustom = tour.kind === "custom";
    var link = el("a", "button-primary button-compact", {
      href: "https://wa.me/48883917920",
      target: "_blank",
      rel: "noopener"
    });

    /* Only real tours get data-whatsapp: script.js rewrites those links with
       the tour name in the message, which the tailor-made card has no use
       for — it opens a plain conversation. */
    if (!isCustom) {
      link.setAttribute("data-whatsapp", "");
      link.setAttribute("data-type", tour.whatsappType || lang(tour, "en").title || "");
    }

    link.appendChild(
      isCustom
        ? textNode("span", "button-text", "cta.whatsapp", "Discuss on WhatsApp")
        : textNode("span", "button-text", "cta.bookTour", "Book This Tour")
    );
    link.insertAdjacentHTML("beforeend", ARROW_ICONS);
    return link;
  }

  function tourCard(tour, index) {
    var isCustom = tour.kind === "custom";
    var en = lang(tour, "en");

    var card = el(
      "article",
      "destination-card" + (isCustom ? " destination-card--custom" : ""),
      { "data-reveal": "", style: "--index:" + index }
    );

    if (!isCustom) {
      card.appendChild(el("div", "destination-card-gradient-block", { "aria-hidden": "true" }));
      if (tour.image) {
        card.appendChild(
          el("img", "destination-card-image" + (tour.imageFocus === "left" ? " destination-card-image--focus-left" : ""), {
            src: tour.image,
            alt: tour.imageAlt || en.title || "",
            loading: "lazy",
            decoding: "async"
          })
        );
      }
    }

    var description = el("div", "destination-card-description");

    var tagBlock = el("div", "destination-card-country-block");
    tagBlock.appendChild(textNode("span", "paragraph-p3", tourKey(tour, "tag"), en.tag));
    description.appendChild(tagBlock);

    var bottom = el("div", "designation-card-bottom-block");
    bottom.appendChild(textNode("h3", "destination-name", tourKey(tour, "title"), en.title));
    bottom.appendChild(textNode("p", "destination-card-text", tourKey(tour, "desc"), en.desc));

    var price = priceBlock(tour);
    if (price) bottom.appendChild(price);

    bottom.appendChild(bookingButton(tour));
    description.appendChild(bottom);
    card.appendChild(description);

    return card;
  }

  function renderTours(tours) {
    var container = document.querySelector("[data-tours-list]");
    if (!container) return;

    container.textContent = "";
    tours.forEach(function (tour, index) {
      registerTour(tour);
      container.appendChild(tourCard(tour, index));
    });
  }

  /* The two lead forms offer the same tours in their type dropdown. Rebuilt
     from the same list, so a tour added in the panel is bookable through the
     form on the very same load. */
  function renderTourOptions(tours) {
    var groups = document.querySelectorAll("[data-tours-options]");
    if (!groups.length) return;

    Array.prototype.forEach.call(groups, function (group) {
      group.textContent = "";
      tours.forEach(function (tour) {
        if (tour.kind === "custom") return;
        var en = lang(tour, "en");
        var value = tour.whatsappType || en.title || "";
        if (!value) return;
        group.appendChild(
          textNode("option", null, tourKey(tour, "title"), en.title, { value: value })
        );
      });
    });
  }

  /* ------------------------------------------------------------------------
     Reviews — video tiles
     ------------------------------------------------------------------------ */

  var PLAY_ICON =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">' +
    '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11.14-6.86a1 1 0 0 0 0-1.72L9.52 4.28A1 1 0 0 0 8 5.14Z"/></svg>';

  function videoTile(review) {
    var article = el("article", "review-tile");
    var media = el("div", "review-tile__media", { "data-video-tile": "" });

    /* The sources travel on the tile rather than being hard-coded in
       script.js, so each review can carry its own clip. */
    if (review.video) media.setAttribute("data-video", review.video);
    if (review.videoWebm) media.setAttribute("data-video-webm", review.videoWebm);

    if (review.photo) {
      media.appendChild(
        el("img", "review-tile__photo", {
          src: review.photo,
          alt: "Traveler who reviewed Krakow Insiders",
          loading: "lazy",
          decoding: "async"
        })
      );
    }

    var foot = el("div", "review-tile__foot");
    var person = el("div", "review-tile__person");

    if (review.photo) {
      person.appendChild(
        el("img", "review-tile__avatar", { src: review.photo, alt: "", loading: "lazy", decoding: "async" })
      );
    }

    var meta = el("div", "review-tile__meta");
    meta.appendChild(textNode("span", "review-tile__name", null, review.name));
    meta.appendChild(textNode("span", "review-tile__date", null, review.date));
    person.appendChild(meta);
    foot.appendChild(person);

    var play = el("button", "review-tile__play", {
      type: "button",
      "data-play-inline": "",
      "data-reviewer": review.name || "",
      "aria-label": "Play video review" + (review.name ? " from " + review.name : "")
    });
    play.innerHTML = PLAY_ICON;
    foot.appendChild(play);

    media.appendChild(foot);
    article.appendChild(media);
    return article;
  }

  function renderVideoReviews(reviews) {
    var track = document.querySelector('[data-review-panel="video"]');
    if (!track) return;

    track.textContent = "";
    reviews.forEach(function (review) {
      track.appendChild(videoTile(review));
    });
    toggleTab("video", reviews.length > 0);
  }

  /* ------------------------------------------------------------------------
     Reviews — text cards
     ------------------------------------------------------------------------ */

  function reviewKey(review, field) {
    return "reviews." + review.id + "." + field;
  }

  function textCard(review) {
    var en = lang(review, "en");
    var pl = lang(review, "pl");
    registerPolish(reviewKey(review, "author"), pl.author);
    registerPolish(reviewKey(review, "text"), pl.text);

    var card = el("article", "review-card");

    var head = el("div", "review-card__head");
    if (review.avatar) {
      head.appendChild(
        el("img", "review-card__avatar", { src: review.avatar, alt: "", loading: "lazy", decoding: "async" })
      );
    }

    var who = el("div", "review-card__who");
    who.appendChild(textNode("span", "review-card__name", reviewKey(review, "author"), en.author));
    who.appendChild(textNode("span", "review-card__date", null, review.date));
    head.appendChild(who);
    card.appendChild(head);

    var stars = Math.max(1, Math.min(5, parseInt(review.stars, 10) || 5));
    card.appendChild(
      textNode("span", "review-card__stars", null, new Array(stars + 1).join("★"), {
        role: "img",
        "aria-label": stars + " out of 5 stars"
      })
    );

    card.appendChild(textNode("p", "review-card__text", reviewKey(review, "text"), en.text));
    return card;
  }

  function renderTextReviews(reviews) {
    var track = document.querySelector('[data-review-panel="text"]');
    if (!track) return;

    track.textContent = "";
    reviews.forEach(function (review) {
      track.appendChild(textCard(review));
    });
    toggleTab("text", reviews.length > 0);
  }

  /* A tab with nothing behind it is a dead end, so an empty panel hides its
     own button — and if only one kind of review is left, the toggle goes
     entirely and that panel is shown outright. */
  function toggleTab(name, hasItems) {
    var button = document.querySelector('[data-review-tab="' + name + '"]');
    if (button) button.hidden = !hasItems;
  }

  function settleTabs(content) {
    var toggle = document.querySelector(".reviews-toggle");
    if (!toggle) return;

    var hasVideo = content.videoReviews.length > 0;
    var hasText = content.textReviews.length > 0;

    if (hasVideo && hasText) return;
    toggle.hidden = true;

    var visible = hasVideo ? "video" : "text";
    document.querySelectorAll("[data-review-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-review-panel") !== visible;
    });
  }

  /* Nothing to show at all: drop the whole section rather than leave a
     heading floating above an empty strip. */
  function hideEmptySection(content) {
    var section = document.getElementById("reviews");
    if (section && !content.videoReviews.length && !content.textReviews.length) {
      section.hidden = true;
    }
  }

  /* ------------------------------------------------------------------------
     Load
     ------------------------------------------------------------------------ */

  function normalize(content) {
    var safe = content && typeof content === "object" ? content : {};
    return {
      tours: Array.isArray(safe.tours) ? safe.tours : [],
      videoReviews: Array.isArray(safe.videoReviews) ? safe.videoReviews : [],
      textReviews: Array.isArray(safe.textReviews) ? safe.textReviews : []
    };
  }

  function visibleOnly(list) {
    return list.filter(function (item) {
      return item && item.visible !== false;
    });
  }

  function fetchContent() {
    return fetch(ENDPOINT, { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) throw new Error("api-" + response.status);
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.ok) throw new Error("api-payload");
        return normalize(payload.content);
      })
      .catch(function () {
        /* The API is unreachable — a cold deploy, a storage outage, or the
           page opened straight off the filesystem. The seed that ships with
           the site keeps the section populated instead of blank. */
        return fetch(FALLBACK)
          .then(function (response) {
            if (!response.ok) throw new Error("seed-" + response.status);
            return response.json();
          })
          .then(function (seed) {
            var content = normalize(seed);
            return {
              tours: visibleOnly(content.tours),
              videoReviews: visibleOnly(content.videoReviews),
              textReviews: visibleOnly(content.textReviews)
            };
          });
      });
  }

  function render(content) {
    renderTours(content.tours);
    renderTourOptions(content.tours);
    renderVideoReviews(content.videoReviews);
    renderTextReviews(content.textReviews);
    settleTabs(content);
    hideEmptySection(content);
  }

  function whenDomReady() {
    if (document.readyState === "loading") {
      return new Promise(function (resolve) {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      });
    }
    return Promise.resolve();
  }

  /* Resolves either way. A rejected promise here would stop script.js from
     booting, which would cost the whole page over a content problem. */
  window.KI_CONTENT_READY = Promise.all([fetchContent(), whenDomReady()])
    .then(function (results) {
      render(results[0]);
    })
    .catch(function () {
      /* Sections stay as the markup left them. */
    });

  window.KI_LANGS = LANGS;
})();
