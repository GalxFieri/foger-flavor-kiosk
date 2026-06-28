/* ============================================================
   Foger Switch — Flavor Kiosk
   Plain JS, no dependencies. Loads flavors.json, renders the
   grid, handles search + category filters, and runs the
   FLIP "zoom-to-detail" animation.
   ============================================================ */

(() => {
  "use strict";

  const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const IDLE_MS = 60000; // attract screen after 60s of no touch

  // --- State ---
  let CATS = {};          // id -> {name, hue}
  let FLAVORS = [];       // [{name, category, profile, hue, catName}]
  let activeCat = "all";  // current category filter
  let query = "";         // current search text

  // --- Elements ---
  const els = {
    grid:        document.getElementById("grid"),
    filters:     document.getElementById("filters"),
    search:      document.getElementById("search"),
    searchClear: document.getElementById("searchClear"),
    resultCount: document.getElementById("resultCount"),
    empty:       document.getElementById("empty"),
    scrim:       document.getElementById("scrim"),
    detail:      document.getElementById("detail"),
    detailClose: document.getElementById("detailClose"),
    detailName:  document.getElementById("detailName"),
    detailBadge: document.getElementById("detailBadge"),
    detailProfile: document.getElementById("detailProfile"),
    attract:     document.getElementById("attract"),
    attractCount:document.getElementById("attractCount"),
  };

  // ============================================================
  // Load data
  // ============================================================
  fetch("flavors.json", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(init)
    .catch((err) => {
      els.grid.innerHTML =
        `<p class="empty" style="grid-column:1/-1">Couldn't load flavors.json — ${err.message}.<br>` +
        `Make sure the kiosk is served from a folder (not opened as a bare file).</p>`;
      console.error(err);
    });

  function init(data) {
    (data.categories || []).forEach((c) => (CATS[c.id] = c));
    FLAVORS = (data.flavors || []).map((f) => {
      const cat = CATS[f.category] || { name: "Other", hue: 222 };
      return { ...f, hue: cat.hue, catName: cat.name };
    });

    els.attractCount.textContent = FLAVORS.length;
    buildFilters(data.categories || []);
    render();
    wireEvents();
    resetIdle();
  }

  // ============================================================
  // Filters (category chips)
  // ============================================================
  function buildFilters(categories) {
    const chips = [`<button class="chip all active" data-cat="all">All</button>`];
    categories.forEach((c) => {
      // only show a chip if at least one flavor uses it
      if (!FLAVORS.some((f) => f.category === c.id)) return;
      chips.push(
        `<button class="chip" data-cat="${c.id}" style="--hue:${c.hue}">` +
        `<span class="dot"></span>${c.name}</button>`
      );
    });
    els.filters.innerHTML = chips.join("");
  }

  // ============================================================
  // Render grid
  // ============================================================
  function render() {
    const q = query.trim().toLowerCase();
    const list = FLAVORS.filter((f) => {
      const okCat = activeCat === "all" || f.category === activeCat;
      const okQ = !q || f.name.toLowerCase().includes(q) || f.catName.toLowerCase().includes(q);
      return okCat && okQ;
    });

    els.grid.innerHTML = list
      .map((f, i) => {
        const idx = FLAVORS.indexOf(f);
        return (
          `<button class="card" data-idx="${idx}" style="--hue:${f.hue}; animation-delay:${Math.min(i * 12, 360)}ms">` +
          `<span class="card-cat"><span class="dot"></span>${f.catName}</span>` +
          `<span class="card-name">${escapeHtml(f.name)}</span>` +
          `</button>`
        );
      })
      .join("");

    const showEmpty = list.length === 0;
    els.empty.hidden = !showEmpty;
    els.grid.style.display = showEmpty ? "none" : "";
    els.resultCount.textContent = showEmpty
      ? ""
      : `${list.length} flavor${list.length === 1 ? "" : "s"}` +
        (activeCat !== "all" ? ` · ${CATS[activeCat].name}` : "") +
        (q ? ` · “${query.trim()}”` : "");
  }

  // ============================================================
  // FLIP zoom-to-detail
  // ============================================================
  let openIdx = null;

  function openDetail(card) {
    const idx = +card.dataset.idx;
    const f = FLAVORS[idx];
    if (!f) return;
    openIdx = idx;

    // Fill content
    els.detail.style.setProperty("--hue", f.hue);
    els.detailBadge.innerHTML = `<span class="card-cat-dot"></span>${escapeHtml(f.catName)}`;
    els.detailName.textContent = f.name;
    els.detailProfile.textContent = f.profile || "";

    // Reveal, then (after a reflow) animate from the closed state defined in CSS.
    // The transition itself lives in styles.css (.detail / .detail.show, .scrim.show)
    // so both opening and closing animate consistently.
    els.scrim.hidden = false;
    els.detail.hidden = false;
    void els.detail.offsetWidth; // commit the closed state before adding .show
    els.scrim.classList.add("show");
    els.detail.classList.add("show");
    lockScroll(true);
  }

  function closeDetail() {
    if (openIdx === null) return;
    openIdx = null;

    els.scrim.classList.remove("show");
    els.detail.classList.remove("show");

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      els.detail.hidden = true;
      els.scrim.hidden = true;
    };
    els.detail.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 520); // safety net if transitionend doesn't fire

    lockScroll(false);
  }

  function lockScroll(on) { els.grid.style.overflowY = on ? "hidden" : "auto"; }

  // ============================================================
  // Events
  // ============================================================
  function wireEvents() {
    // Card tap (delegated)
    els.grid.addEventListener("click", (e) => {
      const card = e.target.closest(".card");
      if (card && openIdx === null) openDetail(card);
    });

    // Close: X button, scrim, or tapping the detail itself
    els.detailClose.addEventListener("click", closeDetail);
    els.scrim.addEventListener("click", closeDetail);
    els.detail.addEventListener("click", (e) => {
      if (e.target !== els.detailClose) closeDetail();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

    // Search
    els.search.addEventListener("input", () => {
      query = els.search.value;
      els.searchClear.hidden = query.length === 0;
      render();
    });
    els.searchClear.addEventListener("click", () => {
      query = ""; els.search.value = ""; els.searchClear.hidden = true;
      els.search.focus(); render();
    });

    // Category chips (delegated)
    els.filters.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      activeCat = chip.dataset.cat;
      [...els.filters.children].forEach((c) => c.classList.toggle("active", c === chip));
      els.grid.scrollTop = 0;
      render();
    });

    // Idle / attract handling
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) =>
      document.addEventListener(ev, onActivity, { passive: true })
    );
    els.attract.addEventListener("click", wakeFromAttract);
  }

  // ============================================================
  // Idle attract screen
  // ============================================================
  let idleTimer = null;
  let attractOn = false;

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(showAttract, IDLE_MS);
  }
  function onActivity() {
    if (attractOn) return; // taps while attract is up are handled by wakeFromAttract
    resetIdle();
  }
  function showAttract() {
    attractOn = true;
    closeDetail();
    // reset browsing state so the next customer starts fresh
    activeCat = "all"; query = ""; els.search.value = ""; els.searchClear.hidden = true;
    [...els.filters.children].forEach((c, i) => c.classList.toggle("active", i === 0));
    render();
    els.grid.scrollTop = 0;
    els.attract.classList.add("show");
    els.attract.setAttribute("aria-hidden", "false");
  }
  function wakeFromAttract() {
    attractOn = false;
    els.attract.classList.remove("show");
    els.attract.setAttribute("aria-hidden", "true");
    resetIdle();
  }

  // ============================================================
  // Util
  // ============================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
})();
