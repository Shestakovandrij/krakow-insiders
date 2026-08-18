/* ==========================================================================
   Krakow Insiders — панель керування

   Один екран, один запит на збереження. Уся сторінка тримає копію контенту в
   пам'яті, правки пишуться просто в неї, а «Зберегти» відправляє все разом —
   тож ніщо не потрапляє на сайт напівдорозі.

   Картки перемальовуються лише коли змінюється їхня структура (додали,
   видалили, посунули). Набір тексту в полі оновлює модель і заголовок
   картки, але не чіпає DOM самого поля — інакше курсор стрибав би на
   кожній літері.
   ========================================================================== */

(function () {
  "use strict";

  var API_ADMIN = "/api/admin";
  var API_UPLOAD = "/api/upload";

  var IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
  var VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";

  /* Поріг, з якого файл вантажиться частинами. Нижче — одним запитом:
     multipart для маленького фото лише додає зайвих обмінів. */
  var MULTIPART_FROM = 8 * 1024 * 1024;

  var state = {
    content: null,
    pending: [],
    dirty: false,
    saving: false,
    tab: "tours",
    subtab: "video",
    persistentStorage: true,
    minPasswordLength: 10
  };

  var dom = {};

  /* ------------------------------------------------------------------------
     Дрібні помічники
     ------------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function api(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    return fetch(API_ADMIN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json()
        .catch(function () { return { ok: false, error: "bad-response" }; })
        .then(function (data) {
          data.status = response.status;
          return data;
        });
    });
  }

  function uniqueId(prefix, existing) {
    var taken = {};
    existing.forEach(function (item) { taken[item.id] = true; });
    var index = existing.length + 1;
    var candidate;
    do {
      candidate = prefix + "-" + index;
      index += 1;
    } while (taken[candidate]);
    return candidate;
  }

  /* ------------------------------------------------------------------------
     Стан «є незбережені зміни»
     ------------------------------------------------------------------------ */

  function markDirty() {
    state.dirty = true;
    dom.saveState.textContent = "Є незбережені зміни";
    dom.saveState.className = "save-state is-dirty";
    dom.saveBtn.disabled = false;
  }

  function markClean(message) {
    state.dirty = false;
    dom.saveState.textContent = message || "Змін немає";
    dom.saveState.className = "save-state" + (message ? " is-saved" : "");
    dom.saveBtn.disabled = true;
  }

  function notify(message, kind) {
    dom.notice.textContent = message;
    dom.notice.className = "banner" + (kind ? " banner--" + kind : "");
    dom.notice.hidden = false;
    if (kind !== "error") {
      window.setTimeout(function () { dom.notice.hidden = true; }, 4000);
    }
  }

  /* ------------------------------------------------------------------------
     Вхід і перший запуск
     ------------------------------------------------------------------------ */

  function showGate(which) {
    dom.gate.hidden = false;
    dom.app.hidden = true;
    dom.gateLoading.hidden = true;
    dom.setupForm.hidden = which !== "setup";
    dom.loginForm.hidden = which !== "login";
    var input = which === "setup" ? dom.setupPassword : dom.loginPassword;
    if (input) input.focus();
  }

  function checkStatus() {
    return api("status").then(function (data) {
      if (!data.ok) throw new Error("status-failed");

      state.persistentStorage = data.persistentStorage !== false;
      state.minPasswordLength = data.minPasswordLength || 10;
      dom.setupHint.textContent = "Мінімум " + state.minPasswordLength + " символів";

      if (!data.passwordSet) {
        showGate("setup");
        return false;
      }
      if (!data.authenticated) {
        showGate("login");
        return false;
      }
      return true;
    });
  }

  function enterApp() {
    dom.gate.hidden = true;
    dom.app.hidden = false;
    dom.storageWarning.hidden = state.persistentStorage;
    return loadContent();
  }

  function loadContent() {
    return api("load").then(function (data) {
      if (!data.ok) {
        notify("Не вдалося завантажити вміст: " + (data.error || "невідома помилка"), "error");
        return;
      }
      state.content = data.content;
      state.pending = data.pending || [];
      renderAll();
      markClean();
    });
  }

  /* ------------------------------------------------------------------------
     Завантаження медіа

     На Vercel файл іде з браузера просто в сховище — функція лише видає
     короткоживучий токен, тож ліміт у 4.5 МБ на тіло запиту тут ні до чого.
     Локально сховища немає, і той самий файл приймає /api/upload.
     ------------------------------------------------------------------------ */

  function uploadFile(file, onProgress) {
    if (!state.persistentStorage) {
      return fetch(API_UPLOAD + "?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": file.type },
        credentials: "same-origin",
        body: file
      }).then(function (response) {
        return response.json().then(function (data) {
          if (!response.ok || !data.ok) throw new Error(describeUploadError(data));
          return data.url;
        });
      });
    }

    return import("../js/vendor/blob-client.js").then(function (blob) {
      return blob.upload("media/" + file.name, file, {
        access: "public",
        handleUploadUrl: API_UPLOAD,
        contentType: file.type,
        multipart: file.size > MULTIPART_FROM,
        onUploadProgress: function (event) {
          if (onProgress) onProgress(event.percentage || 0);
        }
      }).then(function (result) { return result.url; });
    });
  }

  function describeUploadError(data) {
    if (!data) return "не вдалося завантажити файл";
    if (data.error === "file-too-large") {
      return "файл завеликий (ліміт " + Math.round((data.maxBytes || 0) / 1048576) + " МБ)";
    }
    if (data.error === "type-not-allowed") return "цей тип файлу не приймається";
    if (data.error === "unauthorized") return "сесія завершилася — увійдіть знову";
    return data.error || "не вдалося завантажити файл";
  }

  /* Блок «прев'ю + кнопка вибору + поле з адресою». Використовується і для
     фото, і для відео; різниця лише в accept і в тому, що показувати. */
  function mediaField(options) {
    var wrap = el("div", "media");

    var preview;
    function refreshPreview() {
      var value = options.get();
      if (preview) wrap.removeChild(preview);

      if (value && options.kind === "image") {
        preview = document.createElement("img");
        preview.className = "media__preview";
        preview.src = value;
        preview.alt = "";
      } else if (value && options.kind === "video") {
        preview = document.createElement("video");
        preview.className = "media__preview";
        preview.src = value;
        preview.muted = true;
        preview.playsInline = true;
        preview.controls = true;
        preview.preload = "metadata";
      } else {
        preview = el("div", "media__preview media__preview--empty",
          options.kind === "video" ? "Відео немає" : "Фото немає");
      }
      wrap.insertBefore(preview, wrap.firstChild);
    }

    var side = el("div", "media__side");

    var row = el("div", "media__row");
    var pickBtn = el("button", "btn btn--secondary btn--small", options.label || "Вибрати файл");
    pickBtn.type = "button";

    var input = document.createElement("input");
    input.type = "file";
    input.accept = options.kind === "video" ? VIDEO_ACCEPT : IMAGE_ACCEPT;
    input.hidden = true;

    var clearBtn = el("button", "btn btn--danger btn--small", "Прибрати");
    clearBtn.type = "button";

    row.appendChild(pickBtn);
    row.appendChild(clearBtn);
    row.appendChild(input);
    side.appendChild(row);

    var urlInput = document.createElement("input");
    urlInput.className = "field__input";
    urlInput.type = "text";
    urlInput.value = options.get() || "";
    urlInput.placeholder = "images/… або посилання https://…";
    side.appendChild(urlInput);

    var hint = el("span", "field__hint", options.hint || "");
    side.appendChild(hint);

    var progress = el("div", "media__progress");
    var fill = el("div", "media__progress-fill");
    progress.appendChild(fill);
    progress.hidden = true;
    side.appendChild(progress);

    var error = el("div", "media__error");
    error.hidden = true;
    side.appendChild(error);

    wrap.appendChild(side);
    refreshPreview();

    function commit(value) {
      options.set(value);
      urlInput.value = value;
      refreshPreview();
      markDirty();
      if (options.onChange) options.onChange();
    }

    pickBtn.addEventListener("click", function () { input.click(); });

    clearBtn.addEventListener("click", function () { commit(""); });

    urlInput.addEventListener("input", function () {
      options.set(urlInput.value.trim());
      markDirty();
      if (options.onChange) options.onChange();
    });
    urlInput.addEventListener("change", refreshPreview);

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;

      error.hidden = true;
      progress.hidden = false;
      fill.style.width = "0%";
      pickBtn.disabled = true;
      pickBtn.textContent = "Завантаження…";

      uploadFile(file, function (percentage) {
        fill.style.width = percentage + "%";
      }).then(function (url) {
        commit(url);
      }).catch(function (err) {
        error.textContent = "Не вдалося завантажити: " + (err && err.message ? err.message : err);
        error.hidden = false;
      }).then(function () {
        progress.hidden = true;
        pickBtn.disabled = false;
        pickBtn.textContent = options.label || "Вибрати файл";
        input.value = "";
      });
    });

    return wrap;
  }

  /* ------------------------------------------------------------------------
     Прості поля
     ------------------------------------------------------------------------ */

  function textField(label, get, set, options) {
    var config = options || {};
    var wrap = el("label", "field");
    wrap.appendChild(el("span", "field__label", label));

    var input;
    if (config.multiline) {
      input = document.createElement("textarea");
      input.className = "field__textarea";
      input.rows = config.rows || 3;
    } else {
      input = document.createElement("input");
      input.className = "field__input";
      input.type = "text";
    }
    input.value = get() || "";
    if (config.placeholder) input.placeholder = config.placeholder;

    input.addEventListener("input", function () {
      set(input.value);
      markDirty();
      if (config.onChange) config.onChange();
    });

    wrap.appendChild(input);
    if (config.hint) wrap.appendChild(el("span", "field__hint", config.hint));
    return wrap;
  }

  function selectField(label, choices, get, set, hint) {
    var wrap = el("label", "field");
    wrap.appendChild(el("span", "field__label", label));

    var select = document.createElement("select");
    select.className = "field__select";
    choices.forEach(function (choice) {
      var option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      select.appendChild(option);
    });
    select.value = get();

    select.addEventListener("change", function () {
      set(select.value);
      markDirty();
    });

    wrap.appendChild(select);
    if (hint) wrap.appendChild(el("span", "field__hint", hint));
    return wrap;
  }

  function switchField(label, get, set) {
    var wrap = el("label", "switch");
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!get();
    input.addEventListener("change", function () {
      set(input.checked);
      markDirty();
    });
    wrap.appendChild(input);
    wrap.appendChild(el("span", null, label));
    return wrap;
  }

  /* ------------------------------------------------------------------------
     Каркас картки
     ------------------------------------------------------------------------ */

  function itemCard(config) {
    var item = el("article", "item");
    if (config.entry.visible === false) item.classList.add("is-hidden-entry");

    var head = el("div", "item__head");

    var thumb;
    function refreshThumb() {
      var src = config.thumb();
      if (thumb) head.removeChild(thumb);
      if (src) {
        thumb = document.createElement("img");
        thumb.className = "item__thumb";
        thumb.src = src;
        thumb.alt = "";
      } else {
        thumb = el("div", "item__thumb item__thumb--empty", "—");
      }
      head.insertBefore(thumb, head.firstChild);
    }

    var summary = el("div", "item__summary");
    var name = el("div", "item__name");
    var meta = el("div", "item__meta");
    summary.appendChild(name);
    summary.appendChild(meta);

    function refreshSummary() {
      clear(name);
      name.appendChild(document.createTextNode(config.title() || "Без назви"));
      if (config.entry.visible === false) {
        name.appendChild(el("span", "chip chip--hidden", "приховано"));
      }
      meta.textContent = config.meta();
    }

    var tools = el("div", "item__tools");

    var upBtn = el("button", "btn btn--ghost btn--small", "↑");
    upBtn.type = "button";
    upBtn.title = "Вище";
    upBtn.addEventListener("click", function () { config.move(-1); });

    var downBtn = el("button", "btn btn--ghost btn--small", "↓");
    downBtn.type = "button";
    downBtn.title = "Нижче";
    downBtn.addEventListener("click", function () { config.move(1); });

    var hideBtn = el("button", "btn btn--ghost btn--small",
      config.entry.visible === false ? "Показати" : "Сховати");
    hideBtn.type = "button";
    hideBtn.addEventListener("click", function () {
      config.entry.visible = config.entry.visible === false;
      hideBtn.textContent = config.entry.visible === false ? "Показати" : "Сховати";
      item.classList.toggle("is-hidden-entry", config.entry.visible === false);
      refreshSummary();
      markDirty();
    });

    var deleteBtn = el("button", "btn btn--danger btn--small", "Видалити");
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", function () {
      if (window.confirm("Видалити «" + (config.title() || "без назви") + "»?")) config.remove();
    });

    var toggleBtn = el("button", "btn btn--secondary btn--small", "Редагувати");
    toggleBtn.type = "button";

    tools.appendChild(upBtn);
    tools.appendChild(downBtn);
    tools.appendChild(hideBtn);
    tools.appendChild(deleteBtn);
    tools.appendChild(toggleBtn);

    head.appendChild(summary);
    head.appendChild(tools);
    item.appendChild(head);

    var body = el("div", "item__body");
    body.hidden = true;
    item.appendChild(body);

    toggleBtn.addEventListener("click", function () {
      body.hidden = !body.hidden;
      toggleBtn.textContent = body.hidden ? "Редагувати" : "Згорнути";
    });

    refreshThumb();
    refreshSummary();

    config.build(body, { refreshSummary: refreshSummary, refreshThumb: refreshThumb });
    return item;
  }

  function sectionLabel(text) {
    return el("div", "section-label", text);
  }

  /* ------------------------------------------------------------------------
     Тури
     ------------------------------------------------------------------------ */

  var PRICE_UNITS = [
    { value: "person", label: "/ person — за особу" },
    { value: "personDay", label: "/ person, full day — за особу, цілий день" },
    { value: "", label: "без підпису" }
  ];

  var FOCUS_CHOICES = [
    { value: "", label: "по центру" },
    { value: "left", label: "зі зсувом ліворуч" }
  ];

  function buildTourBody(tour, body, hooks) {
    var isCustom = tour.kind === "custom";

    if (isCustom) {
      body.appendChild(sectionLabel("Картка «на замовлення»"));
      var note = el("p", "panel__lead",
        "Це картка без фото й ціни: вона веде у WhatsApp для індивідуального " +
        "маршруту. Якщо вона не потрібна — сховайте або видаліть її.");
      note.style.marginBottom = "18px";
      body.appendChild(note);
    } else {
      body.appendChild(sectionLabel("Фото"));
      body.appendChild(mediaField({
        kind: "image",
        label: "Вибрати фото",
        hint: "JPG, PNG або WebP. Горизонтальне фото виглядає найкраще.",
        get: function () { return tour.image; },
        set: function (value) { tour.image = value; },
        onChange: hooks.refreshThumb
      }));

      body.appendChild(textField("Опис фото (alt)", function () { return tour.imageAlt; },
        function (value) { tour.imageAlt = value; },
        { hint: "Читають пошукові системи й програми екранного доступу." }));

      var focusRow = el("div", "grid-3");
      focusRow.appendChild(selectField("Кадрування", FOCUS_CHOICES,
        function () { return tour.imageFocus || ""; },
        function (value) { tour.imageFocus = value; }));
      focusRow.appendChild(textField("Ціна", function () { return tour.price.amount; },
        function (value) { tour.price.amount = value; },
        { placeholder: "380 zł", onChange: hooks.refreshSummary,
          hint: "Порожньо — блок ціни зникне." }));
      focusRow.appendChild(selectField("Підпис до ціни", PRICE_UNITS,
        function () { return tour.price.unit || ""; },
        function (value) { tour.price.unit = value; }));
      body.appendChild(focusRow);

      var fromWrap = el("div", "field");
      fromWrap.appendChild(switchField("Показувати «from» / «od» перед ціною",
        function () { return tour.price.from; },
        function (value) { tour.price.from = value; }));
      body.appendChild(fromWrap);

      body.appendChild(textField("Назва в повідомленні WhatsApp",
        function () { return tour.whatsappType; },
        function (value) { tour.whatsappType = value; },
        { placeholder: "Auschwitz-Birkenau Tour",
          hint: "Так тур називатиметься у випадному списку форми бронювання." }));
    }

    body.appendChild(sectionLabel("Тексти"));

    var langs = el("div", "langs");

    var enCol = el("div", "langs__col");
    enCol.appendChild(el("div", "langs__title", "English"));
    enCol.appendChild(textField("Мітка", function () { return tour.en.tag; },
      function (value) { tour.en.tag = value; }, { placeholder: "6–7 hours" }));
    enCol.appendChild(textField("Назва", function () { return tour.en.title; },
      function (value) { tour.en.title = value; }, { onChange: hooks.refreshSummary }));
    enCol.appendChild(textField("Опис", function () { return tour.en.desc; },
      function (value) { tour.en.desc = value; }, { multiline: true, rows: 4 }));

    var plCol = el("div", "langs__col");
    plCol.appendChild(el("div", "langs__title", "Polski"));
    plCol.appendChild(textField("Мітка", function () { return tour.pl.tag; },
      function (value) { tour.pl.tag = value; }, { placeholder: "6–7 godzin" }));
    plCol.appendChild(textField("Назва", function () { return tour.pl.title; },
      function (value) { tour.pl.title = value; }));
    plCol.appendChild(textField("Опис", function () { return tour.pl.desc; },
      function (value) { tour.pl.desc = value; }, { multiline: true, rows: 4 }));

    langs.appendChild(enCol);
    langs.appendChild(plCol);
    body.appendChild(langs);

    var plHint = el("p", "field__hint",
      "Порожнє польське поле означає, що на польській версії сайту " +
      "покажеться англійський текст.");
    body.appendChild(plHint);
  }

  function renderTours() {
    var list = dom.toursList;
    clear(list);

    var tours = state.content.tours;
    if (!tours.length) {
      list.appendChild(el("div", "list__empty", "Жодного туру. Натисніть «Додати тур»."));
      return;
    }

    tours.forEach(function (tour, index) {
      /* Нормалізація на випадок вручну правленого JSON — щоб редактор не
         спіткнувся об відсутнє вкладене поле. */
      if (!tour.price) tour.price = { amount: "", from: false, unit: "person" };
      if (!tour.en) tour.en = {};
      if (!tour.pl) tour.pl = {};

      list.appendChild(itemCard({
        entry: tour,
        thumb: function () { return tour.image; },
        title: function () { return tour.en.title || tour.pl.title; },
        meta: function () {
          var bits = [];
          if (tour.kind === "custom") bits.push("картка «на замовлення»");
          if (tour.price && tour.price.amount) {
            bits.push((tour.price.from ? "від " : "") + tour.price.amount);
          }
          if (tour.en.tag) bits.push(tour.en.tag);
          return bits.join(" · ");
        },
        move: function (offset) { moveItem(tours, index, offset, renderTours); },
        remove: function () {
          tours.splice(index, 1);
          markDirty();
          renderTours();
        },
        build: function (body, hooks) { buildTourBody(tour, body, hooks); }
      }));
    });
  }

  function addTour() {
    var tours = state.content.tours;
    var tour = {
      id: uniqueId("tour", tours),
      kind: "tour",
      visible: true,
      image: "",
      imageAlt: "",
      imageFocus: "",
      price: { amount: "", from: false, unit: "person" },
      whatsappType: "",
      en: { tag: "", title: "Новий тур", desc: "" },
      pl: { tag: "", title: "", desc: "" }
    };

    /* Картка «на замовлення» за задумом стоїть останньою, тож новий тур
       стає перед нею, а не після. */
    var customAt = tours.findIndex(function (item) { return item.kind === "custom"; });
    if (customAt === -1) tours.push(tour);
    else tours.splice(customAt, 0, tour);

    markDirty();
    renderTours();
  }

  /* ------------------------------------------------------------------------
     Відео-відгуки
     ------------------------------------------------------------------------ */

  function buildVideoBody(review, body, hooks) {
    body.appendChild(sectionLabel("Фото на плитці"));
    body.appendChild(mediaField({
      kind: "image",
      label: "Вибрати фото",
      hint: "Видно до натискання кнопки програвання. Вертикальне фото підходить найкраще.",
      get: function () { return review.photo; },
      set: function (value) { review.photo = value; },
      onChange: hooks.refreshThumb
    }));

    body.appendChild(sectionLabel("Відео"));
    body.appendChild(mediaField({
      kind: "video",
      label: "Вибрати відео",
      hint: "MP4, WebM або MOV, до 300 МБ. Програється просто в плитці.",
      get: function () { return review.video; },
      set: function (value) {
        review.video = value;
        /* Запасний webm лишався від файлів, що йшли в комплекті; для нового
           відео він уже не той самий ролик. */
        review.videoWebm = "";
      },
      onChange: hooks.refreshSummary
    }));

    body.appendChild(sectionLabel("Підпис"));
    var row = el("div", "grid-2");
    row.appendChild(textField("Ім'я", function () { return review.name; },
      function (value) { review.name = value; }, { onChange: hooks.refreshSummary }));
    row.appendChild(textField("Дата", function () { return review.date; },
      function (value) { review.date = value; },
      { placeholder: "12.03.2026", hint: "Показується як є, без переформатування." }));
    body.appendChild(row);
  }

  function renderVideoReviews() {
    var list = dom.videoList;
    clear(list);

    var reviews = state.content.videoReviews;
    if (!reviews.length) {
      list.appendChild(el("div", "list__empty",
        "Відео-відгуків немає. Вкладка «Video reviews» на сайті не показуватиметься."));
      return;
    }

    reviews.forEach(function (review, index) {
      list.appendChild(itemCard({
        entry: review,
        thumb: function () { return review.photo; },
        title: function () { return review.name; },
        meta: function () {
          var bits = [];
          if (review.date) bits.push(review.date);
          bits.push(review.video ? "відео завантажене" : "без відео");
          return bits.join(" · ");
        },
        move: function (offset) { moveItem(reviews, index, offset, renderVideoReviews); },
        remove: function () {
          reviews.splice(index, 1);
          markDirty();
          renderVideoReviews();
        },
        build: function (body, hooks) { buildVideoBody(review, body, hooks); }
      }));
    });
  }

  function addVideoReview() {
    var reviews = state.content.videoReviews;
    reviews.push({
      id: uniqueId("v", reviews),
      visible: true,
      name: "Новий відгук",
      date: "",
      photo: "",
      video: "",
      videoWebm: ""
    });
    markDirty();
    renderVideoReviews();
  }

  /* ------------------------------------------------------------------------
     Текстові відгуки
     ------------------------------------------------------------------------ */

  var STAR_CHOICES = [5, 4, 3, 2, 1].map(function (n) {
    return { value: String(n), label: new Array(n + 1).join("★") + " — " + n };
  });

  function buildTextBody(review, body, hooks) {
    body.appendChild(sectionLabel("Фото"));
    body.appendChild(mediaField({
      kind: "image",
      label: "Вибрати фото",
      hint: "Невеликий круглий аватар біля імені.",
      get: function () { return review.avatar; },
      set: function (value) { review.avatar = value; },
      onChange: hooks.refreshThumb
    }));

    var row = el("div", "grid-2");
    row.appendChild(textField("Дата", function () { return review.date; },
      function (value) { review.date = value; }, { placeholder: "12.03.2026" }));
    row.appendChild(selectField("Оцінка", STAR_CHOICES,
      function () { return String(review.stars || 5); },
      function (value) {
        review.stars = parseInt(value, 10);
        hooks.refreshSummary();
      }));
    body.appendChild(row);

    body.appendChild(sectionLabel("Тексти"));

    var langs = el("div", "langs");

    var enCol = el("div", "langs__col");
    enCol.appendChild(el("div", "langs__title", "English"));
    enCol.appendChild(textField("Автор", function () { return review.en.author; },
      function (value) { review.en.author = value; },
      { placeholder: "Amelia — United Kingdom", onChange: hooks.refreshSummary }));
    enCol.appendChild(textField("Відгук", function () { return review.en.text; },
      function (value) { review.en.text = value; }, { multiline: true, rows: 5 }));

    var plCol = el("div", "langs__col");
    plCol.appendChild(el("div", "langs__title", "Polski"));
    plCol.appendChild(textField("Автор", function () { return review.pl.author; },
      function (value) { review.pl.author = value; },
      { placeholder: "Amelia — Wielka Brytania" }));
    plCol.appendChild(textField("Відгук", function () { return review.pl.text; },
      function (value) { review.pl.text = value; }, { multiline: true, rows: 5 }));

    langs.appendChild(enCol);
    langs.appendChild(plCol);
    body.appendChild(langs);
  }

  function renderTextReviews() {
    var list = dom.textList;
    clear(list);

    var reviews = state.content.textReviews;
    if (!reviews.length) {
      list.appendChild(el("div", "list__empty",
        "Текстових відгуків немає. Вкладка «Text reviews» на сайті не показуватиметься."));
      return;
    }

    reviews.forEach(function (review, index) {
      if (!review.en) review.en = {};
      if (!review.pl) review.pl = {};

      list.appendChild(itemCard({
        entry: review,
        thumb: function () { return review.avatar; },
        title: function () { return review.en.author || review.pl.author; },
        meta: function () {
          var bits = [];
          if (review.date) bits.push(review.date);
          bits.push(new Array((review.stars || 5) + 1).join("★"));
          return bits.join(" · ");
        },
        move: function (offset) { moveItem(reviews, index, offset, renderTextReviews); },
        remove: function () {
          reviews.splice(index, 1);
          markDirty();
          renderTextReviews();
        },
        build: function (body, hooks) { buildTextBody(review, body, hooks); }
      }));
    });
  }

  function addTextReview() {
    var reviews = state.content.textReviews;
    reviews.push({
      id: uniqueId("r", reviews),
      visible: true,
      avatar: "",
      date: "",
      stars: 5,
      en: { author: "Новий відгук", text: "" },
      pl: { author: "", text: "" }
    });
    markDirty();
    renderTextReviews();
  }

  /* ------------------------------------------------------------------------
     Спільне
     ------------------------------------------------------------------------ */

  function moveItem(list, index, offset, rerender) {
    var target = index + offset;
    if (target < 0 || target >= list.length) return;
    var moved = list.splice(index, 1)[0];
    list.splice(target, 0, moved);
    markDirty();
    rerender();
  }

  /* ------------------------------------------------------------------------
     Черга модерації

     Тут нічого не редагується — лише рішення. Підтверджений відгук одразу
     лягає у збережений вміст, тож картка зникає з черги й з'являється у
     відповідній вкладці.
     ------------------------------------------------------------------------ */

  function formatSubmittedAt(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear() +
      ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function pendingCard(entry) {
    var card = el("article", "pending");

    var media = el("div", "pending__media");
    if (entry.photo) {
      var photo = document.createElement("img");
      photo.className = "pending__photo";
      photo.src = entry.photo;
      photo.alt = "";
      media.appendChild(photo);
    }
    if (entry.video) {
      var video = document.createElement("video");
      video.className = "pending__video";
      video.src = entry.video;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      media.appendChild(video);
    }
    if (!entry.photo && !entry.video) {
      media.appendChild(el("div", "pending__none", "без медіа"));
    }
    card.appendChild(media);

    var body = el("div", "pending__body");

    var who = entry.name + (entry.country ? " — " + entry.country : "");
    body.appendChild(el("div", "pending__who", who));

    var meta = el("div", "pending__meta");
    meta.appendChild(el("span", "pending__stars", new Array((entry.stars || 5) + 1).join("★")));
    var when = formatSubmittedAt(entry.submittedAt);
    if (when) meta.appendChild(document.createTextNode("  ·  " + when));
    body.appendChild(meta);

    body.appendChild(el("p", "pending__text", entry.text));

    var actions = el("div", "pending__actions");

    var approveText = el("button", "btn btn--primary btn--small", "Опублікувати як текстовий");
    approveText.type = "button";
    approveText.addEventListener("click", function () { approve(entry, "text", actions); });
    actions.appendChild(approveText);

    if (entry.video) {
      var approveVideo = el("button", "btn btn--secondary btn--small", "Опублікувати як відео");
      approveVideo.type = "button";
      approveVideo.addEventListener("click", function () { approve(entry, "video", actions); });
      actions.appendChild(approveVideo);
    }

    var reject = el("button", "btn btn--danger btn--small", "Відхилити");
    reject.type = "button";
    reject.addEventListener("click", function () {
      if (!window.confirm("Відхилити відгук від «" + entry.name + "»? Його буде видалено.")) return;
      busy(actions, true);
      api("reject", { id: entry.id }).then(function (data) {
        if (!data.ok) {
          notify("Не вдалося відхилити: " + (data.error || "невідома помилка"), "error");
          busy(actions, false);
          return;
        }
        state.pending = data.pending || [];
        renderPending();
      });
    });
    actions.appendChild(reject);

    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function busy(actions, isBusy) {
    Array.prototype.forEach.call(actions.children, function (button) {
      button.disabled = isBusy;
    });
  }

  function approve(entry, as, actions) {
    /* Незбережені правки полетіли б разом із перечитаним вмістом, тож
       спершу треба їх зберегти. */
    if (state.dirty) {
      notify("Спершу збережіть зміни у турах чи відгуках — інакше вони загубляться.", "error");
      return;
    }

    busy(actions, true);
    api("approve", { id: entry.id, as: as }).then(function (data) {
      if (!data.ok) {
        notify(data.error === "no-video"
          ? "У цьому відгуку немає відео."
          : "Не вдалося опублікувати: " + (data.error || "невідома помилка"), "error");
        busy(actions, false);
        return;
      }
      state.content = data.content;
      state.pending = data.pending || [];
      renderAll();
      markClean("Збережено");
      notify("Відгук на сайті.", null);
    });
  }

  function renderPending() {
    var list = dom.pendingList;
    clear(list);

    var count = state.pending.length;
    dom.pendingBadge.hidden = count === 0;
    dom.pendingBadge.textContent = String(count);

    if (!count) {
      list.appendChild(el("div", "list__empty",
        "Нових відгуків немає. Тут з'являтиметься все, що надішлють через " +
        "кнопку «Leave a review» на сайті."));
      return;
    }

    state.pending.forEach(function (entry) {
      list.appendChild(pendingCard(entry));
    });
  }

  function renderAll() {
    renderTours();
    renderVideoReviews();
    renderTextReviews();
    renderPending();
  }

  function save() {
    if (state.saving || !state.content) return;
    state.saving = true;
    dom.saveBtn.disabled = true;
    dom.saveState.textContent = "Збереження…";
    dom.saveState.className = "save-state";

    api("save", { content: state.content }).then(function (data) {
      if (!data.ok) {
        if (data.status === 401) {
          notify("Сесія завершилася. Перезавантажте сторінку й увійдіть знову.", "error");
        } else {
          notify("Не вдалося зберегти: " + (data.error || "невідома помилка"), "error");
        }
        markDirty();
        return;
      }
      /* Сервер повертає вміст після перевірки — беремо саме його, щоб на
         екрані було рівно те, що лежить у сховищі. */
      state.content = data.content;
      renderAll();
      markClean("Збережено");
      notify("Зміни на сайті.", null);
    }).catch(function () {
      notify("Немає зв'язку із сервером. Спробуйте ще раз.", "error");
      markDirty();
    }).then(function () {
      state.saving = false;
    });
  }

  /* ------------------------------------------------------------------------
     Вкладки та меню
     ------------------------------------------------------------------------ */

  function switchTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(dom.tabs.children, function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-tab") === name);
    });
    dom.panelTours.hidden = name !== "tours";
    dom.panelReviews.hidden = name !== "reviews";
    dom.panelPending.hidden = name !== "pending";
  }

  function switchSubtab(name) {
    state.subtab = name;
    Array.prototype.forEach.call(dom.subtabs.children, function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-subtab") === name);
    });
    dom.panelVideo.hidden = name !== "video";
    dom.panelText.hidden = name !== "text";
  }

  function closeMenu() {
    dom.menuList.hidden = true;
    dom.menuBtn.setAttribute("aria-expanded", "false");
  }

  function openModal(modal) {
    modal.hidden = false;
    var input = modal.querySelector("input");
    if (input) input.focus();
  }

  function closeModal(modal) {
    modal.hidden = true;
    modal.querySelectorAll("input").forEach(function (input) { input.value = ""; });
    var error = modal.querySelector(".gate__error");
    if (error) error.hidden = true;
  }

  /* ------------------------------------------------------------------------
     Запуск
     ------------------------------------------------------------------------ */

  function cacheDom() {
    [
      "gate", "gateLoading", "setupForm", "loginForm", "setupPassword", "setupRepeat",
      "setupError", "setupHint", "loginPassword", "loginError", "app", "tabs", "subtabs",
      "panelTours", "panelReviews", "panelVideo", "panelText", "toursList", "videoList",
      "textList", "panelPending", "pendingList", "pendingBadge",
      "saveBtn", "saveState", "notice", "storageWarning", "menuBtn", "menuList",
      "addTour", "addVideoReview", "addTextReview", "logoutBtn", "resetBtn", "passwordBtn",
      "passwordModal", "passwordForm", "currentPassword", "newPassword", "passwordError"
    ].forEach(function (id) { dom[id] = $(id); });
  }

  function showError(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function bindGate() {
    dom.setupForm.addEventListener("submit", function (event) {
      event.preventDefault();
      dom.setupError.hidden = true;

      var password = dom.setupPassword.value;
      if (password.length < state.minPasswordLength) {
        showError(dom.setupError, "Пароль закороткий — потрібно щонайменше " +
          state.minPasswordLength + " символів.");
        return;
      }
      if (password !== dom.setupRepeat.value) {
        showError(dom.setupError, "Паролі не збігаються.");
        return;
      }

      api("setup", { password: password }).then(function (data) {
        if (!data.ok) {
          showError(dom.setupError, data.error === "already-set"
            ? "Пароль уже встановлено. Перезавантажте сторінку."
            : "Не вдалося встановити пароль.");
          return;
        }
        enterApp();
      });
    });

    dom.loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      dom.loginError.hidden = true;

      api("login", { password: dom.loginPassword.value }).then(function (data) {
        if (!data.ok) {
          if (data.error === "locked") {
            var minutes = Math.ceil((data.retryAfter || 900) / 60);
            showError(dom.loginError, "Забагато спроб. Спробуйте за " + minutes + " хв.");
          } else if (typeof data.attemptsLeft === "number") {
            showError(dom.loginError, "Невірний пароль. Залишилось спроб: " + data.attemptsLeft + ".");
          } else {
            showError(dom.loginError, "Невірний пароль.");
          }
          dom.loginPassword.select();
          return;
        }
        enterApp();
      });
    });
  }

  function bindApp() {
    dom.saveBtn.addEventListener("click", save);
    dom.addTour.addEventListener("click", addTour);
    dom.addVideoReview.addEventListener("click", addVideoReview);
    dom.addTextReview.addEventListener("click", addTextReview);

    dom.tabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-tab]");
      if (button) switchTab(button.getAttribute("data-tab"));
    });

    dom.subtabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-subtab]");
      if (button) switchSubtab(button.getAttribute("data-subtab"));
    });

    dom.menuBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      var open = dom.menuList.hidden;
      dom.menuList.hidden = !open;
      dom.menuBtn.setAttribute("aria-expanded", String(open));
    });

    document.addEventListener("click", function (event) {
      if (!dom.menuList.hidden && !event.target.closest(".menu")) closeMenu();
    });

    dom.logoutBtn.addEventListener("click", function () {
      if (state.dirty && !window.confirm("Є незбережені зміни. Вийти без збереження?")) return;
      api("logout").then(function () { window.location.reload(); });
    });

    dom.resetBtn.addEventListener("click", function () {
      closeMenu();
      if (!window.confirm(
        "Повернути тури й відгуки до початкового вмісту сайту? " +
        "Усе, що ви додали або змінили, буде втрачено."
      )) return;

      api("reset").then(function (data) {
        if (!data.ok) {
          notify("Не вдалося відновити: " + (data.error || "невідома помилка"), "error");
          return;
        }
        state.content = data.content;
        renderAll();
        markClean("Відновлено");
      });
    });

    dom.passwordBtn.addEventListener("click", function () {
      closeMenu();
      openModal(dom.passwordModal);
    });

    dom.passwordModal.addEventListener("click", function (event) {
      if (event.target.hasAttribute("data-close-modal")) closeModal(dom.passwordModal);
    });

    dom.passwordForm.addEventListener("submit", function (event) {
      event.preventDefault();
      dom.passwordError.hidden = true;

      if (dom.newPassword.value.length < state.minPasswordLength) {
        showError(dom.passwordError, "Новий пароль закороткий — потрібно щонайменше " +
          state.minPasswordLength + " символів.");
        return;
      }

      api("change-password", {
        currentPassword: dom.currentPassword.value,
        newPassword: dom.newPassword.value
      }).then(function (data) {
        if (!data.ok) {
          showError(dom.passwordError, data.error === "too-short"
            ? "Новий пароль закороткий."
            : "Поточний пароль невірний.");
          return;
        }
        closeModal(dom.passwordModal);
        notify("Пароль змінено.", null);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeMenu();
        if (!dom.passwordModal.hidden) closeModal(dom.passwordModal);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (state.dirty) save();
      }
    });

    window.addEventListener("beforeunload", function (event) {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  function start() {
    cacheDom();
    bindGate();
    bindApp();

    checkStatus().then(function (authenticated) {
      if (authenticated) return enterApp();
    }).catch(function () {
      dom.gate.hidden = false;
      dom.gateLoading.textContent =
        "Немає зв'язку із сервером. Перевірте, що сайт запущено, і перезавантажте сторінку.";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
