/* ============================================================
   Foger Switch — Flavor Cards kiosk
   Loads flavors.json, renders a pod-hero card per flavor, with
   search + category filters, tap-to-reveal profile, and a
   persistent per-flavor star rating (localStorage).

   Real pod photos: drop a transparent PNG at pods/<flavor-id>.png
   and it auto-replaces the stylized pod for that flavor.
   ============================================================ */
(() => {
  "use strict";

  const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const IDLE_MS = 60000;
  const RKEY = "foger.ratings";

  let CATS = {};            // id -> {id,name,hue}
  let FLAVORS = [];         // [{name,category,profile,id,cat,params,accent,accentH}]
  let activeCat = "all", query = "";
  const ratedThisSession = new Set();
  const photoState = {};    // id -> true|false (pods/<id>.png available?)

  const els = {
    grid:document.getElementById("grid"), filters:document.getElementById("filters"),
    search:document.getElementById("search"), searchClear:document.getElementById("searchClear"),
    resultCount:document.getElementById("resultCount"), empty:document.getElementById("empty"),
    attract:document.getElementById("attract"), attractCount:document.getElementById("attractCount"),
  };

  // ---------- per-flavor pod colors ----------
  // h = hue; s = saturation (default 68); dark = force dark label text;
  // kind = "marble" override. Colors read from the real Foger pod photos
  // (fogervapes.com) where available, else matched to the flavor.
  const MARBLE_CATS = new Set(["dessert","candy"]);
  const FLAVOR_COLORS = {
    // frozen / ice
    "frozen-pineapple":{h:50,dark:true}, "frozen-blackberry":{h:282}, "frozen-watermelon":{h:352},
    "frozen-blueberry":{h:215}, "frozen-lemon":{h:54,dark:true}, "frozen-banana":{h:50,dark:true},
    "watermelon-ice":{h:352}, "strawberry-ice":{h:350}, "juicy-peach-ice":{h:24}, "blue-razz-ice":{h:218},
    "frozen-vanilla":{h:44,s:30,dark:true}, "frozen-tropical":{h:40}, "frozen-peach":{h:24},
    "frozen-kiwi":{h:100,dark:true}, "frozen-cherry":{h:355}, "orange-cranberry-lime-ice":{h:30},
    // sour
    "sour-fcuking-fab":{h:325}, "sour-gush":{h:350}, "sour-cranapple":{h:355}, "sour-blue-dust":{h:210},
    "sour-apple-ice":{h:95,dark:true}, "sour-grape-gush":{h:275}, "sour-kiwi-gush":{h:100,dark:true},
    "sour-blueberry-gush":{h:215}, "sour-blackberry-gush":{h:285}, "sour-cherry-gush":{h:355},
    "sour-mango-pineapple":{h:42,dark:true}, "sour-apple-watermelon":{h:95,dark:true},
    // beverage
    "sour-raspberry-punch":{h:345}, "purple-passion-punch":{h:278}, "triple-berry-punch":{h:290},
    "hawaiian-punch":{h:350}, "cherry-slush":{h:350}, "strawberry-slush":{h:345}, "peach-slush":{h:22},
    "orange-slush":{h:32}, "grape-slush":{h:275}, "cola-slush":{h:32,s:35}, "coffee":{h:28,s:32},
    // candy
    "pink-blue":{h:318}, "strawberry-b-pop":{h:348}, "blue-rancher-b-pop":{h:195}, "omg-b-pop":{h:320},
    "white-gummy":{h:210,s:8,dark:true}, "gummy-bear":{h:350}, "strawberry-cotton-candy":{h:335},
    "blueberry-cotton-candy":{h:255}, "watermelon-cotton-candy":{h:345},
    // dessert
    "chocolate-cupcake":{h:25,s:32}, "vanilla-cupcake":{h:44,s:28,dark:true}, "red-velvet-cupcake":{h:357},
    "skittles-cupcake":{h:322}, "coconut-cupcake":{h:40,s:24,dark:true}, "strawberry-cupcake":{h:350},
    "vanilla-ice-cream":{h:44,s:26,dark:true}, "strawnana-ice-cream":{h:350,s:42},
    // fruit
    "berry-bliss":{h:272}, "california-cherry":{h:352}, "dragon-melon":{h:135,kind:"marble"}, "meta-moon":{h:30},
    "cherry-bomb":{h:358}, "pink-lemonade":{h:340}, "dragon-fruit-lemonade":{h:328}, "watermelon-bubble-gum":{h:348},
    "strawberry-watermelon":{h:352}, "strawberry-kiwi":{h:100,dark:true}, "strawberry-banana":{h:44,dark:true},
    "pineapple-coconut":{h:50,dark:true}, "mexico-mango":{h:38}, "kiwi-dragon-berry":{h:105,dark:true},
    "cherry-lemon":{h:355}, "blueberry-watermelon":{h:210}, "banana-taffey-freeze":{h:48,dark:true},
    "white-peach-raspberry":{h:18}, "georgia-peach":{h:24}, "summer-mist":{h:195}, "strawberry-burst":{h:350},
    "passion-kiwi":{h:80,dark:true},
    // mint
    "icy-mint":{h:185}, "miami-mint":{h:165}, "gum-mint":{h:205}, "cool-mint":{h:168}, "winter-green":{h:150},
    // tobacco / other
    "tobacco":{h:28,s:30}, "clear":{h:210,s:6,dark:true}, "fcuking-fab":{h:330},
  };

  function resolveParams(id, cat){
    const spec = FLAVOR_COLORS[id] || { h: cat.hue };
    const h = spec.h, s = spec.s != null ? spec.s : 68;
    const kind = spec.kind || (MARBLE_CATS.has(cat.id) ? "marble" : "solid");
    const darkText = spec.dark != null ? spec.dark : (h >= 42 && h <= 115);
    return {
      kind,
      mouth:`hsl(${h} ${Math.max(0,s-8)}% 62%)`, tank:`hsl(${h} ${Math.max(0,s-14)}% 84%)`,
      body:[`hsl(${h} ${s}% 52%)`, `hsl(${h} ${s}% 36%)`], marbleDark:`hsl(${h} ${s}% 40%)`,
      text: darkText ? "#241f10" : "#ffffff",
      accent:`hsl(${h} ${Math.min(92,s+12)}% 58%)`, accentH:h,
    };
  }

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
  const esc  = (s) => String(s).replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // ---------- pod SVG ----------
  function podSVG(f){
    const p = f.params, u = f.id, nameUp = f.name.toUpperCase();
    const fs = nameUp.length > 13 ? 10 : (nameUp.length > 9 ? 11.5 : 13);
    const coils = [49,65,81,97].map(x =>
      `<rect x="${x}" y="70" width="5" height="120" rx="2.5" fill="url(#coil-${u})"/>`+
      `<circle cx="${x+2.5}" cy="120" r="2.3" fill="#9aa0ad"/><circle cx="${x+2.5}" cy="150" r="2.3" fill="#9aa0ad"/>`
    ).join("");
    let body;
    if (p.kind === "solid"){
      body = `<rect x="34" y="200" width="82" height="168" rx="15" fill="url(#body-${u})"/>`+
             `<rect x="44" y="210" width="11" height="150" rx="5" fill="#fff" opacity="0.16"/>`;
    } else {
      const sw=(cx,cy,rx,ry,r,fill,op)=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${cx} ${cy})" fill="${fill}" opacity="${op}"/>`;
      body = `<g clip-path="url(#bclip-${u})"><rect x="34" y="200" width="82" height="168" fill="${p.body[0]}"/>`+
        sw(60,234,30,15,-25,`url(#soft-${u})`,0.9)+sw(95,262,26,13,22,`url(#soft-${u})`,0.85)+
        sw(64,302,34,17,-15,`url(#soft-${u})`,0.8)+sw(96,332,24,12,26,`url(#soft-${u})`,0.75)+
        sw(82,250,30,12,32,p.marbleDark,0.5)+sw(56,322,26,12,-22,p.marbleDark,0.45)+
        `</g><rect x="44" y="210" width="10" height="150" rx="5" fill="#fff" opacity="0.18"/>`;
    }
    return `<svg viewBox="0 0 150 384" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(f.name)} pod"><defs>`+
      `<linearGradient id="body-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.body[0]}"/><stop offset="1" stop-color="${p.body[1]}"/></linearGradient>`+
      `<linearGradient id="coil-${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f2f5f9"/><stop offset="0.5" stop-color="#cfd5de"/><stop offset="1" stop-color="#9aa1ad"/></linearGradient>`+
      `<radialGradient id="soft-${u}"><stop offset="0" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`+
      `<clipPath id="bclip-${u}"><rect x="34" y="200" width="82" height="168" rx="15"/></clipPath></defs>`+
      `<ellipse cx="75" cy="372" rx="46" ry="8" fill="#000" opacity="0.16"/>`+
      `<path d="M51 46 L51 22 Q51 10 63 10 Q70 10 72 18 Q75 15 78 18 Q80 10 87 10 Q99 10 99 22 L99 46 Z" fill="${p.mouth}" opacity="0.9"/>`+
      `<rect x="73" y="14" width="4" height="30" rx="2" fill="#000" opacity="0.18"/>`+
      `<rect x="42" y="42" width="66" height="18" rx="5" fill="${p.mouth}" opacity="0.92"/>`+
      `<rect x="42" y="47" width="66" height="2" fill="#000" opacity="0.16"/><rect x="42" y="53" width="66" height="2" fill="#000" opacity="0.16"/>`+
      `<rect x="37" y="58" width="76" height="150" rx="10" fill="${p.tank}"/>${coils}`+
      `<rect x="43" y="64" width="9" height="138" rx="4" fill="#fff" opacity="0.4"/>`+
      body+
      `<rect x="34" y="318" width="82" height="50" rx="15" fill="#000" opacity="0.12"/>`+
      `<rect x="100" y="352" width="9" height="12" rx="2" fill="#000" opacity="0.45"/>`+
      `<text transform="translate(72 290) rotate(-90)" text-anchor="middle" fill="${p.text}" style="font-family:Outfit,sans-serif;font-weight:700;letter-spacing:1px;font-size:${fs}px;">${esc(nameUp)}</text>`+
      `</svg>`;
  }

  // ---------- ratings ----------
  const loadR = () => { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch(e){ return {}; } };
  const saveR = (r) => { try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch(e){} };
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

  // ---------- load ----------
  fetch("flavors.json",{cache:"no-store"}).then(r=>{ if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(init).catch(err=>{ els.grid.innerHTML=`<p class="empty" style="grid-column:1/-1">Couldn't load flavors.json — ${err.message}</p>`; });

  function init(data){
    (data.categories||[]).forEach(c=>CATS[c.id]=c);
    FLAVORS = (data.flavors||[]).map(f=>{
      const cat = CATS[f.category] || {id:"other",name:"Other",hue:222};
      const id = slug(f.name);
      const params = resolveParams(id, cat);
      return { name:f.name, profile:f.profile||"", category:f.category, cat, id, params,
               accent:params.accent, accentH:params.accentH };
    });
    els.attractCount.textContent = FLAVORS.length;
    buildFilters(data.categories||[]);
    render(); wire(); resetIdle();
  }

  function buildFilters(categories){
    const chips = [`<button class="chip all active" data-cat="all">All</button>`];
    categories.forEach(c=>{ if(!FLAVORS.some(f=>f.category===c.id)) return;
      chips.push(`<button class="chip" data-cat="${c.id}" style="--hue:${c.hue}"><span class="dot"></span>${esc(c.name)}</button>`); });
    els.filters.innerHTML = chips.join("");
  }

  // ---------- render ----------
  function render(){
    const q = query.trim().toLowerCase();
    const list = FLAVORS.filter(f=>{
      const okCat = activeCat==="all" || f.category===activeCat;
      const okQ = !q || f.name.toLowerCase().includes(q) || f.cat.name.toLowerCase().includes(q);
      return okCat && okQ;
    });
    els.grid.innerHTML = list.map((f,i)=>{
      const hero = photoState[f.id]===true ? `<img src="pods/${f.id}.png" alt="${esc(f.name)} pod"/>` : podSVG(f);
      return `<div class="card" data-id="${f.id}" style="--accent:${f.accent};--accent-h:${f.accentH};animation-delay:${Math.min(i*12,360)}ms">`+
        `<div class="hero">${hero}</div>`+
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
        `</div></div>`;
    }).join("");

    const showEmpty = list.length===0;
    els.empty.hidden = !showEmpty; els.grid.style.display = showEmpty ? "none" : "";
    els.resultCount.textContent = showEmpty ? "" :
      `${list.length} flavor${list.length===1?"":"s"}`+(activeCat!=="all"?` · ${CATS[activeCat].name}`:"")+(q?` · “${query.trim()}”`:"");
    list.forEach(f=>{ if(photoState[f.id]===undefined) probePhoto(f); });
  }

  function probePhoto(f){
    const img = new Image();
    img.onload = ()=>{ photoState[f.id]=true;
      document.querySelectorAll(`.card[data-id="${f.id}"] .hero`).forEach(h=>{ h.innerHTML=`<img src="pods/${f.id}.png" alt="${esc(f.name)} pod"/>`; }); };
    img.onerror = ()=>{ photoState[f.id]=false; };
    img.src = `pods/${f.id}.png`;
  }

  // ---------- events (delegated) ----------
  function wire(){
    els.grid.addEventListener("click",(e)=>{
      const card = e.target.closest(".card"); if(!card) return;
      const id = card.dataset.id;
      const starBtn = e.target.closest(".rate-stars button");
      if (starBtn){ if(ratedThisSession.has(id)) return;
        recordRating(id, +starBtn.dataset.star);
        card.querySelector(".rating").innerHTML = renderRating(id);
        card.classList.remove("rating-open");
        const b=card.querySelector(".rate-btn"); b.disabled=true; b.textContent="Rated ✓"; return; }
      if (e.target.closest(".rate-btn")){ if(ratedThisSession.has(id)) return; card.classList.toggle("rating-open"); return; }
      if (e.target.closest(".meta")) return;
      const open = card.classList.toggle("open"); if(!open) card.classList.remove("rating-open");
    });
    els.grid.addEventListener("pointerover",(e)=>{
      const star=e.target.closest(".rate-stars button"); if(!star) return;
      const sibs=[...star.parentElement.children]; const i=sibs.indexOf(star);
      sibs.forEach((s,j)=>s.classList.toggle("hot", j<=i));
    });
    els.grid.addEventListener("pointerout",(e)=>{
      const wrap=e.target.closest(".rate-stars"); if(wrap) [...wrap.children].forEach(s=>s.classList.remove("hot"));
    });

    els.search.addEventListener("input",()=>{ query=els.search.value; els.searchClear.hidden=query.length===0; render(); });
    els.searchClear.addEventListener("click",()=>{ query=""; els.search.value=""; els.searchClear.hidden=true; els.search.focus(); render(); });
    els.filters.addEventListener("click",(e)=>{ const chip=e.target.closest(".chip"); if(!chip) return;
      activeCat=chip.dataset.cat; [...els.filters.children].forEach(c=>c.classList.toggle("active",c===chip)); els.grid.scrollTop=0; render(); });

    ["pointerdown","keydown","wheel","touchstart"].forEach(ev=>document.addEventListener(ev,onActivity,{passive:true}));
    els.attract.addEventListener("click",wakeAttract);
  }

  // ---------- idle attract ----------
  let idleTimer=null, attractOn=false;
  function resetIdle(){ clearTimeout(idleTimer); idleTimer=setTimeout(showAttract,IDLE_MS); }
  function onActivity(){ if(attractOn) return; resetIdle(); }
  function showAttract(){
    attractOn=true;
    ratedThisSession.clear();                 // each new customer can rate again
    activeCat="all"; query=""; els.search.value=""; els.searchClear.hidden=true;
    [...els.filters.children].forEach((c,i)=>c.classList.toggle("active",i===0));
    render(); els.grid.scrollTop=0;
    els.attract.classList.add("show"); els.attract.setAttribute("aria-hidden","false");
  }
  function wakeAttract(){ attractOn=false; els.attract.classList.remove("show"); els.attract.setAttribute("aria-hidden","true"); resetIdle(); }
})();
