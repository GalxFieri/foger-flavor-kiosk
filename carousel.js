/* ============================================================
   Foger Switch — Flavor Carousel
   Infinite horizontal coverflow: center card in the foreground,
   two mid-ground neighbors (shifted up, cut off), two background
   neighbors (shifted up more, silhouetted). Fully swipeable with
   momentum; settles on the nearest flavor and auto-opens its
   profile + rating. Starting a new swipe closes it and resumes.
   ============================================================ */
(() => {
  "use strict";

  const IDLE_MS = 60000;
  const RKEY = "foger.ratings";

  // ---------- shared pod art (pod-art.js) ----------
  // FLAVOR_COLORS is the live object from PodArt; seeding a custom flavor's
  // color into it (see init) makes resolveParams/podSVG render that color.
  const { FLAVOR_COLORS, resolveParams, podSVG, slug, esc } = window.PodArt;

  // ---------- category classification: family + iced (per Foger's lines) ----------
  function familyOf(name, categoryId){
    if (name === "Coffee" || name === "Tobacco" || name === "Clear") return "other";
    if (name === "Fcuking FAB") return "fruit";
    if (/punch/i.test(name)) return "punch";
    if (/slush/i.test(name)) return "slush";
    if (categoryId === "sour") return "sour";
    if (categoryId === "candy" || categoryId === "dessert") return "dessert";
    if (categoryId === "mint") return "mint";
    if (name === "Frozen Vanilla") return "dessert";
    if (categoryId === "fruit" || categoryId === "frozen") return "fruit";
    return "other";
  }
  function isIced(name, categoryId){
    // "Ice Cream" flavors (category dessert/candy) aren't part of Foger's
    // Frozen/Ice line — exclude them so the word-match below doesn't
    // mistake "Vanilla Ice Cream" for an iced flavor.
    if (categoryId === "dessert" || categoryId === "candy") return false;
    return categoryId === "frozen" || categoryId === "mint" || /\bice\b/i.test(name) || /freeze/i.test(name);
  }

  const FILTERS = [
    { id:"all",      label:"All",      hue:250, test:()=>true },
    { id:"iced",     label:"Iced",     hue:190, test:(f)=>f.iced },
    { id:"noniced",  label:"Non-Iced", hue:24,  test:(f)=>!f.iced },
    { id:"fruit",    label:"Fruit",    hue:348, test:(f)=>f.family==="fruit" },
    { id:"sour",     label:"Sour",     hue:78,  test:(f)=>f.family==="sour" },
    { id:"punch",    label:"Punch",    hue:300, test:(f)=>f.family==="punch" },
    { id:"slush",    label:"Slush",    hue:205, test:(f)=>f.family==="slush" },
    { id:"dessert",  label:"Dessert",  hue:32,  test:(f)=>f.family==="dessert" },
    { id:"others",   label:"Others",   hue:222, test:(f)=>f.family==="other" },
  ];

  // ---------- ratings (shared localStorage key with cards.js) ----------
  const loadR = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch(e){ return {}; } };
  const saveR = (r) => { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch(e){} };
  const ratedThisSession = new Set();
  function renderRating(id){
    const d = loadR()[id];
    if (!d || !d.count) return `<span class="stars-row">☆☆☆☆☆</span><span class="rating-empty">No ratings yet</span>`;
    const avg = d.sum/d.count, filled = Math.round(avg);
    return `<span class="stars-row"><b>${"★".repeat(filled)}</b>${"☆".repeat(5-filled)}</span>`+
           `<span class="score">${avg.toFixed(1)} <span class="rating-empty">(${d.count})</span></span>`;
  }
  function recordRating(id, stars){
    const all = loadR(), d = all[id] || {sum:0,count:0};
    d.sum += stars; d.count += 1; all[id]=d; saveR(all); ratedThisSession.add(id);
  }

  // ---------- elements ----------
  const els = {
    filters:document.getElementById("filters"), resultCount:document.getElementById("resultCount"),
    stage:document.getElementById("stage"), track:document.getElementById("track"),
    empty:document.getElementById("empty"), attract:document.getElementById("attract"),
    attractCount:document.getElementById("attractCount"),
    prevBtn:document.getElementById("prevBtn"), nextBtn:document.getElementById("nextBtn"),
  };

  // ---------- state ----------
  let ALL_FLAVORS = [];      // full catalog
  let items = [];            // currently filtered flavors (the wrapping ring)
  let cardEls = [];          // DOM node per item (parallel array)
  let activeFilter = "all";
  const photoState = {};

  let pos = 0;               // continuous carousel position (index units)
  let vel = 0;                // velocity (index-units per frame, ~60fps)
  let dragging = false, dragStarted = false;
  let startX = 0, startPos = 0;
  let moveSamples = [];       // rolling {t,pos} window for robust velocity-on-release
  let momentumActive = false, snapping = false, rafId = null;
  let openIndex = null;       // index (into items) currently auto-opened
  let suppressClick = false;

  const FRICTION = 0.945;
  const VEL_EPS = 0.0015;
  const SNAP_EASE = 0.18;
  const VEL_SAMPLE_WINDOW_MS = 100;
  const MAX_VEL = 0.7; // clamp: fastest realistic flick, index-units per frame

  // continuous coverflow keyframes: offset -> {x,scale,y,z,opacity}
  const KEY = [
    { o:0, x:0.00, s:1.00, y:0.00,  z:50, op:1.00 },
    { o:1, x:0.34, s:0.80, y:-0.10, z:40, op:0.95 },
    { o:2, x:0.58, s:0.60, y:-0.20, z:30, op:0.55 },
    { o:3, x:0.78, s:0.46, y:-0.28, z:10, op:0.00 },
  ];
  function lerp(a,b,t){ return a+(b-a)*t; }
  function frameAt(absO){
    const o = Math.min(absO, 3);
    const i = Math.min(Math.floor(o), KEY.length-2);
    const t = o - i;
    const a = KEY[i], b = KEY[i+1];
    return { x: lerp(a.x,b.x,t), s: lerp(a.s,b.s,t), y: lerp(a.y,b.y,t), z: lerp(a.z,b.z,t), op: lerp(a.op,b.op,t) };
  }

  // ---------- load ----------
  fetch("flavors.json",{cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(init).catch(err=>{ els.empty.hidden=false; els.empty.textContent=`Couldn't load flavors.json — ${err.message}`; });

  function init(data){
    const cats = {}; (data.categories||[]).forEach(c=>cats[c.id]=c);

    // Admin-added flavors: seed each one's chosen color into FLAVOR_COLORS so
    // resolveParams/podSVG render it, then fold them in alongside the base
    // catalog. They carry an explicit `iced` flag from the admin form.
    const customs = ((window.KioskStore && KioskStore.getCustomFlavors()) || []).map(c=>{
      const id = slug(c.name);
      const spec = { h: Number(c.hue) || 0 };
      if (c.sat != null) spec.s = Number(c.sat);
      if (c.dark != null) spec.dark = !!c.dark;
      FLAVOR_COLORS[id] = spec;
      return { name:c.name, profile:c.profile||"", category:c.category, iced: !!c.iced };
    });
    const base = (data.flavors||[]).map(f=>({ name:f.name, profile:f.profile||"", category:f.category }));

    ALL_FLAVORS = base.concat(customs).map(f=>{
      const cat = cats[f.category] || {id:"other",name:"Other",hue:222};
      const id = slug(f.name);
      const params = resolveParams(id, cat);
      const family = familyOf(f.name, f.category);
      const iced = f.iced != null ? f.iced : isIced(f.name, f.category);
      return { name:f.name, profile:f.profile||"", category:f.category, cat, id, params,
               accent:params.accent, accentH:params.accentH, family, iced };
    });
    els.attractCount.textContent = ALL_FLAVORS.length;
    buildFilterChips();
    setFilter("all");
    wireGlobalEvents();
    resetIdle();
    requestAnimationFrame(measureAndRender);
    window.addEventListener("resize", measureAndRender);
    window.addEventListener("orientationchange", ()=>setTimeout(measureAndRender, 60));
  }

  function buildFilterChips(){
    els.filters.innerHTML = FILTERS.map(fl =>
      `<button class="chip${fl.id==="all"?" all active":""}" data-filter="${fl.id}" style="--hue:${fl.hue}">`+
      (fl.id==="all" ? "" : `<span class="dot"></span>`)+`${esc(fl.label)}</button>`
    ).join("");
  }

  // ---------- filter + build the ring ----------
  function setFilter(filterId){
    activeFilter = filterId;
    const spec = FILTERS.find(f=>f.id===filterId) || FILTERS[0];
    items = ALL_FLAVORS.filter(spec.test);
    [...els.filters.children].forEach(c => c.classList.toggle("active", c.dataset.filter===filterId));

    pos = 0; vel = 0; openIndex = null; momentumActive = false; snapping = false;
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }

    els.track.innerHTML = "";
    cardEls = items.map((f,i) => buildCardEl(f,i));
    cardEls.forEach(el => els.track.appendChild(el));

    const showEmpty = items.length === 0;
    els.empty.hidden = !showEmpty;
    els.stage.style.visibility = showEmpty ? "hidden" : "";
    els.resultCount.textContent = showEmpty ? "" :
      `${items.length} flavor${items.length===1?"":"s"}`+(filterId!=="all"?` · ${spec.label}`:"");

    if (!showEmpty) settleOpenAt(0); // reveal + rating for the first flavor immediately
    render();
  }

  function buildCardEl(f, idx){
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.index = String(idx);
    el.dataset.id = f.id;
    el.style.setProperty("--accent", f.accent);
    el.style.setProperty("--accent-h", f.accentH);
    // Out-of-stock (admin-toggled): dim + badge, but still fully interactive.
    const outOfStock = !!(window.KioskStore && !KioskStore.isAvailable(f.id));
    if (outOfStock) el.classList.add("unavailable");
    const hero = photoState[f.id]===true ? `<img src="pods/${f.id}.png" alt="${esc(f.name)} pod"/>` : podSVG(f);
    el.innerHTML =
      `<div class="hero">${hero}</div>`+
      (outOfStock ? `<div class="stock-badge">Out of Stock</div>` : "")+
      `<div class="scrim"></div>`+
      `<div class="panel">`+
        `<h2 class="fname">${esc(f.name)}</h2>`+
        `<span class="hint">(tap for flavor profile)</span>`+
        `<div class="reveal">`+
          `<p class="profile">${esc(f.profile)}</p>`+
          `<div class="meta"><div class="rating">${renderRating(f.id)}</div>`+
            `<button class="rate-btn" type="button"${ratedThisSession.has(f.id)?" disabled":""}>${ratedThisSession.has(f.id)?"Rated ✓":"Rate flavor"}</button></div>`+
          `<div class="rate-stars">`+[1,2,3,4,5].map(n=>`<button type="button" data-star="${n}" aria-label="${n} star${n>1?"s":""}">☆</button>`).join("")+`</div>`+
        `</div>`+
      `</div>`;
    if (photoState[f.id]===undefined) probePhoto(f);
    return el;
  }

  function probePhoto(f){
    const img = new Image();
    img.onload = ()=>{ photoState[f.id]=true;
      const el = cardEls[items.indexOf(f)]; if(el) el.querySelector(".hero").innerHTML = `<img src="pods/${f.id}.png" alt="${esc(f.name)} pod"/>`; };
    img.onerror = ()=>{ photoState[f.id]=false; };
    img.src = `pods/${f.id}.png`;
  }

  // ---------- shortest signed wrapped distance ----------
  function wrappedOffset(index, position, n){
    let raw = index - position;
    raw -= n * Math.round(raw / n);
    return raw;
  }

  // ---------- render ----------
  let stageHalf = 400, cardH = 380;
  const CARD_ASPECT = 0.636; // width / height, matches the card's design proportions
  function measureAndRender(){
    const r = els.stage.getBoundingClientRect();

    // Size the card off ACTUAL available space in both dimensions, so it
    // can't overflow on any viewport shape (wide-short landscape phone,
    // narrow-tall portrait phone, tablet, desktop) -- take whichever of a
    // height-driven or width-driven card size is smaller, so both a vertical
    // and a horizontal budget are always respected.
    const chFromHeight = r.height * 0.86;
    const cwFromWidth = r.width * 0.42; // leave room for side cards to peek
    const chFromWidth = cwFromWidth / CARD_ASPECT;
    let ch = Math.min(chFromHeight, chFromWidth);
    ch = Math.max(190, Math.min(460, ch));
    const cw = ch * CARD_ASPECT;
    document.documentElement.style.setProperty("--ch", ch + "px");
    document.documentElement.style.setProperty("--cw", cw + "px");

    stageHalf = Math.max(120, r.width/2);
    cardH = ch;
    render();
  }

  function render(){
    const n = items.length; if (!n) return;
    for (let i=0;i<n;i++){
      const el = cardEls[i]; if (!el) continue;
      const o = wrappedOffset(i, pos, n);
      const absO = Math.abs(o);
      if (absO > 3.4){
        if (el.style.display !== "none") el.style.display = "none";
        continue;
      }
      if (el.style.display === "none") el.style.display = "";
      const fr = frameAt(absO);
      const x = Math.sign(o) * stageHalf * fr.x;
      const y = cardH * fr.y;
      // CSS already centers the box (left:50% + negative margins), so this
      // transform only needs the slot offset/scale, not another -50% shift.
      el.style.transform = `translate(${x}px, ${y}px) scale(${fr.s})`;
      el.style.zIndex = String(Math.round(fr.z));
      el.style.opacity = String(fr.op);
      el.classList.toggle("silhouette", absO >= 1.5);
    }
  }

  // ---------- settle + auto-open ----------
  function settleOpenAt(targetPos){
    pos = targetPos;
    const n = items.length; if(!n) return;
    openIndex = ((Math.round(pos) % n) + n) % n;
    render();
    // Skip the auto-open while idle/attract is showing — the carousel keeps
    // spinning behind the splash and shouldn't pop a reveal panel open.
    requestAnimationFrame(()=>{ if (attractOn) return; const el = cardEls[openIndex]; if(el) el.classList.add("open"); });
  }
  function closeOpen(){
    if (openIndex !== null){ const el = cardEls[openIndex]; if (el){ el.classList.remove("open"); el.classList.remove("rating-open"); } }
    openIndex = null;
  }

  // ---------- momentum / snap loop ----------
  function tick(){
    if (!momentumActive){ rafId = null; return; }
    if (snapping){
      const target = Math.round(pos);
      pos += (target - pos) * SNAP_EASE;
      render();
      if (Math.abs(target - pos) < 0.0015){
        pos = target; momentumActive = false; rafId = null;
        settleOpenAt(pos);
        return;
      }
    } else {
      pos += vel;
      vel *= FRICTION;
      render();
      if (Math.abs(vel) < VEL_EPS) snapping = true;
    }
    rafId = requestAnimationFrame(tick);
  }
  function startMomentum(){
    momentumActive = true;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function goToIndex(targetIndex){
    // animate to the nearest wrapped equivalent of targetIndex
    const n = items.length; if(!n) return;
    closeOpen();
    const offset = wrappedOffset(targetIndex, pos, n);
    const dest = pos + offset;
    animateTo(dest);
  }
  function animateTo(dest){
    momentumActive = true; snapping = false; vel = 0;
    // reuse the snap easing directly toward an explicit destination
    const step = () => {
      pos += (dest - pos) * SNAP_EASE;
      render();
      if (Math.abs(dest - pos) < 0.0015){
        momentumActive = false; rafId = null;
        settleOpenAt(Math.round(dest));
        return;
      }
      rafId = requestAnimationFrame(step);
    };
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(step);
  }

  // ---------- pointer drag ----------
  function onPointerDown(e){
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true; dragStarted = false;
    startX = e.clientX; startPos = pos;
    moveSamples = [{ t: performance.now(), pos }];
    stopAutoplay();
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
    momentumActive = false; snapping = false; vel = 0;
    els.stage.setPointerCapture && e.pointerId != null && els.stage.setPointerCapture(e.pointerId);
    onActivity();
  }
  function onPointerMove(e){
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!dragStarted && Math.abs(dx) > 4){
      dragStarted = true;
      closeOpen();
      els.stage.classList.add("dragging");
    }
    if (!dragStarted) return;
    const unit = Math.max(80, stageHalf * 0.62); // px per one card-step, matches mid-ground anchor
    pos = startPos - dx / unit;
    const now = performance.now();
    moveSamples.push({ t: now, pos });
    while (moveSamples.length > 2 && now - moveSamples[0].t > VEL_SAMPLE_WINDOW_MS) moveSamples.shift();
    render();
  }
  function onPointerUp(){
    if (!dragging) return;
    dragging = false;
    els.stage.classList.remove("dragging");
    if (dragStarted){
      suppressClick = true;
      // Velocity from the span of the recent sample window (not instantaneous
      // per-event deltas, which can have near-zero dt and blow up wildly).
      const first = moveSamples[0], last = moveSamples[moveSamples.length-1];
      const dt = Math.max(8, last.t - first.t);
      vel = ((last.pos - first.pos) / dt) * 16.7;
      vel = Math.max(-MAX_VEL, Math.min(MAX_VEL, vel));
      snapping = Math.abs(vel) < VEL_EPS;
      startMomentum();
    }
    dragStarted = false;
  }

  function onCardClick(e){
    if (suppressClick){ suppressClick = false; return; }
    const starBtn = e.target.closest(".rate-stars button");
    const card = e.target.closest(".card"); if (!card) return;
    const idx = +card.dataset.index; const id = card.dataset.id;

    if (starBtn){
      if (ratedThisSession.has(id)) return;
      recordRating(id, +starBtn.dataset.star);
      card.querySelector(".rating").innerHTML = renderRating(id);
      card.classList.remove("rating-open");
      const b = card.querySelector(".rate-btn"); b.disabled = true; b.textContent = "Rated ✓";
      return;
    }
    if (e.target.closest(".rate-btn")){
      if (ratedThisSession.has(id)) return;
      card.classList.toggle("rating-open");
      return;
    }
    if (e.target.closest(".meta")) return;

    if (idx !== openIndex){ goToIndex(idx); } // tap a visible side card to bring it to center
  }

  function wireGlobalEvents(){
    els.stage.addEventListener("pointerdown", onPointerDown);
    els.stage.addEventListener("pointermove", onPointerMove);
    els.stage.addEventListener("pointerup", onPointerUp);
    els.stage.addEventListener("pointercancel", onPointerUp);
    els.stage.addEventListener("pointerleave", ()=>{ if(dragging) onPointerUp(); });
    els.track.addEventListener("click", onCardClick);
    els.track.addEventListener("pointerover",(e)=>{ const star=e.target.closest(".rate-stars button"); if(!star) return;
      const sibs=[...star.parentElement.children]; const i=sibs.indexOf(star); sibs.forEach((s,j)=>s.classList.toggle("hot", j<=i)); });
    els.track.addEventListener("pointerout",(e)=>{ const wrap=e.target.closest(".rate-stars"); if(wrap) [...wrap.children].forEach(s=>s.classList.remove("hot")); });

    els.prevBtn.addEventListener("click", ()=>{ if(!items.length) return; onActivity(); goToIndex(Math.round(pos)-1); });
    els.nextBtn.addEventListener("click", ()=>{ if(!items.length) return; onActivity(); goToIndex(Math.round(pos)+1); });

    els.filters.addEventListener("click",(e)=>{ const chip=e.target.closest(".chip"); if(!chip) return; onActivity(); setFilter(chip.dataset.filter); });

    ["pointerdown","keydown","wheel"].forEach(ev=>document.addEventListener(ev,onActivity,{passive:true}));
    els.attract.addEventListener("click", wakeAttract);

    // Hidden admin entry: long-press (~1.2s) the "F" brand mark.
    const brand = document.querySelector(".brand-mark");
    if (brand){
      let lpTimer = null;
      const cancelLP = ()=>{ if (lpTimer){ clearTimeout(lpTimer); lpTimer = null; } };
      brand.addEventListener("pointerdown", ()=>{ cancelLP(); lpTimer = setTimeout(()=>{ location.href = "admin.html"; }, 1200); });
      ["pointerup","pointerleave","pointercancel"].forEach(ev=>brand.addEventListener(ev, cancelLP));
    }

    // Live-refresh when the admin panel (another tab) changes kiosk state.
    window.addEventListener("storage",(e)=>{
      if (!window.KioskStore) return;
      const K = KioskStore.KEYS;
      if (e.key === K.availability) setFilter(activeFilter);      // re-apply dim/badge
      else if (e.key === K.customFlavors) location.reload();       // pick up added/removed flavors
    });
  }

  // ---------- idle autoplay (slow continuous drift behind the attract splash) ----------
  let autoplayActive = false;
  const AUTOPLAY_SPEED = 0.0035; // index-units per frame — one card every ~4-5s

  function startAutoplay(){
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
    momentumActive = false; snapping = false; vel = 0;
    autoplayActive = true;
    const step = () => {
      if (!autoplayActive){ rafId = null; return; }
      const n = items.length;
      if (n){ pos += AUTOPLAY_SPEED; if (pos >= n) pos -= n; render(); }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }
  function stopAutoplay(){
    autoplayActive = false;
    if (rafId){ cancelAnimationFrame(rafId); rafId = null; }
  }

  // ---------- idle attract ----------
  let idleTimer=null, attractOn=false;
  function resetIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(showAttract, IDLE_MS); }
  function onActivity(){ if(attractOn) return; resetIdle(); }
  function showAttract(){
    attractOn = true;
    ratedThisSession.clear();
    setFilter("all");
    els.attract.classList.add("show"); els.attract.setAttribute("aria-hidden","false");
    startAutoplay();
  }
  function wakeAttract(){
    attractOn = false; // must flip before animateTo settles, so the auto-open guard allows it
    stopAutoplay();
    els.attract.classList.remove("show"); els.attract.setAttribute("aria-hidden","true");
    resetIdle();
    if (items.length) animateTo(Math.round(pos)); // snap to the nearest flavor + auto-open it
  }
})();
