/* ============================================================
   Foger Switch — Admin panel logic
   Passcode gate (keypad + first-run setup), availability toggles,
   add-flavor (placeholder pod in a chosen color), passcode mgmt.
   All state via KioskStore (localStorage). Pods via PodArt.
   ============================================================ */
(() => {
  "use strict";

  const { podSVG, resolveParamsFromSpec, FLAVOR_COLORS, slug, esc } = window.PodArt;
  const S = window.KioskStore;
  const $ = (id) => document.getElementById(id);

  // Fallback categories if flavors.json can't be fetched (keeps admin usable).
  const FALLBACK_CATS = [
    {id:"fruit",name:"Fruit",hue:348}, {id:"frozen",name:"Frozen / Ice",hue:190},
    {id:"sour",name:"Sour",hue:78}, {id:"beverage",name:"Beverage",hue:268},
    {id:"candy",name:"Candy",hue:322}, {id:"dessert",name:"Dessert",hue:32},
    {id:"mint",name:"Menthol & Mint",hue:158}, {id:"tobacco",name:"Tobacco",hue:28},
    {id:"other",name:"Other",hue:222},
  ];
  const SWATCH_HUES = [0,20,32,50,95,135,168,190,210,250,285,320,345];

  let CATS = [], CATMAP = {}, BASE_FLAVORS = [], session = null;

  // ---------- boot ----------
  fetch("flavors.json", {cache:"no-store"})
    .then(r => { if (!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .then(data => {
      CATS = data.categories && data.categories.length ? data.categories : FALLBACK_CATS;
      BASE_FLAVORS = (data.flavors || []).map(f => ({ name:f.name, category:f.category }));
    })
    .catch(() => { CATS = FALLBACK_CATS; BASE_FLAVORS = []; })
    .finally(() => { CATS.forEach(c => CATMAP[c.id] = c); showGate(); });

  const setMsg = (el, text, kind) => { el.textContent = text || ""; el.className = "msg" + (kind ? " "+kind : ""); };

  // ============================================================
  //  GATE
  // ============================================================
  function showGate(){
    $("panel").hidden = true;
    $("gate").hidden = false;
    if (S.hasPasscodes()){
      $("setupView").hidden = true; $("loginView").hidden = false;
      buildKeypad(); resetEntry();
    } else {
      $("loginView").hidden = true; $("setupView").hidden = false;
      $("setupName").focus();
    }
  }

  // ---- first-run setup ----
  async function doSetup(){
    const name = $("setupName").value.trim() || "Owner";
    const code = $("setupCode").value, confirm = $("setupConfirm").value;
    if (!/^\d{6}$/.test(code)) return setMsg($("setupMsg"), "Passcode must be exactly 6 digits.", "bad");
    if (code !== confirm) return setMsg($("setupMsg"), "The two passcodes don't match.", "bad");
    const res = await S.addPerson(name, code);
    if (!res.ok) return setMsg($("setupMsg"), res.error, "bad");
    session = res.person;
    openPanel();
  }
  $("setupBtn").addEventListener("click", doSetup);
  ["setupCode","setupConfirm"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") doSetup(); }));

  // ---- returning login (keypad) ----
  let entry = "", verifying = false, fails = 0, lockedUntil = 0;
  function buildKeypad(){
    const keys = ["1","2","3","4","5","6","7","8","9","blank","0","back"];
    $("keypad").innerHTML = keys.map(k => {
      if (k === "blank") return `<button class="key blank" disabled aria-hidden="true"></button>`;
      if (k === "back")  return `<button class="key wide" data-k="back" aria-label="Delete">⌫</button>`;
      return `<button class="key" data-k="${k}">${k}</button>`;
    }).join("");
  }
  function renderDots(){
    $("dots").innerHTML = Array.from({length:6}, (_,i) =>
      `<span class="dot${i < entry.length ? " on" : ""}"></span>`).join("");
  }
  function resetEntry(){ entry = ""; renderDots(); }

  $("keypad").addEventListener("click", (e) => {
    const b = e.target.closest(".key"); if (!b || b.disabled) return;
    if (verifying || Date.now() < lockedUntil) return;
    const k = b.dataset.k;
    if (k === "back") entry = entry.slice(0, -1);
    else if (entry.length < 6) entry += k;
    renderDots();
    if (entry.length === 6) attemptLogin();
  });

  async function attemptLogin(){
    verifying = true;
    const person = await S.verify(entry);
    verifying = false;
    if (person){
      fails = 0; session = person; openPanel();
    } else {
      fails++;
      const card = $("loginView");
      card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      resetEntry();
      if (fails >= 5){
        lockedUntil = Date.now() + 15000;
        let left = 15;
        setMsg($("loginMsg"), `Too many attempts. Wait ${left}s.`, "bad");
        const iv = setInterval(() => {
          left--;
          if (left <= 0){ clearInterval(iv); setMsg($("loginMsg"), "", ""); }
          else setMsg($("loginMsg"), `Too many attempts. Wait ${left}s.`, "bad");
        }, 1000);
      } else {
        setMsg($("loginMsg"), "Incorrect passcode.", "bad");
      }
    }
  }

  // ============================================================
  //  PANEL
  // ============================================================
  function openPanel(){
    $("gate").hidden = true;
    $("panel").hidden = false;
    setMsg($("loginMsg"), "", ""); setMsg($("setupMsg"), "", "");
    $("who").textContent = session ? `Signed in as ${session.name}` : "";
    buildCategorySelect();
    buildSwatches();
    updatePreview();
    renderAvailability();
    renderCustomList();
    renderPeople();
    switchTab("avail");
  }

  $("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) switchTab(t.dataset.tab); });
  function switchTab(name){
    [...$("tabs").children].forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["avail","add","pass"].forEach(n => { $("tab-"+n).hidden = n !== name; });
  }

  $("lockBtn").addEventListener("click", () => { session = null; showGate(); });
  $("exitBtn").addEventListener("click", () => { location.href = "carousel.html"; });

  // ---- shared pod thumbnail ----
  function specFor(f){
    if (f.custom){ const s = { h: Number(f.hue)||0 }; if (f.sat != null) s.s = Number(f.sat); if (f.dark != null) s.dark = !!f.dark; return s; }
    const id = slug(f.name);
    return FLAVOR_COLORS[id] || { h: (CATMAP[f.category] || {hue:222}).hue };
  }
  function thumbFor(f){
    const cat = CATMAP[f.category] || { id:f.category, hue:222 };
    const params = resolveParamsFromSpec(specFor(f), cat);
    return podSVG({ id: slug(f.name) || "x", name: f.name, params });
  }

  function allFlavors(){
    const customs = S.getCustomFlavors().map(c => ({ name:c.name, category:c.category, custom:true, hue:c.hue, sat:c.sat, dark:c.dark }));
    return BASE_FLAVORS.map(f => ({ name:f.name, category:f.category, custom:false })).concat(customs);
  }

  // ============================================================
  //  AVAILABILITY
  // ============================================================
  function renderAvailability(){
    const q = $("availSearch").value.trim().toLowerCase();
    const list = allFlavors().filter(f => !q || f.name.toLowerCase().includes(q));
    $("flavorList").innerHTML = list.map(f => {
      const id = slug(f.name), inStock = S.isAvailable(id);
      const catName = (CATMAP[f.category] || {}).name || f.category;
      return `<div class="frow${inStock ? "" : " off"}" data-id="${id}">`+
        `<div class="thumb">${thumbFor(f)}</div>`+
        `<div class="fmeta"><div class="fname">${esc(f.name)}${f.custom ? `<span class="tag-custom">Added</span>` : ""}</div>`+
          `<div class="fcat">${esc(catName)}</div></div>`+
        `<div class="state">${inStock ? "In stock" : "Out"}</div>`+
        `<div class="switch${inStock ? " on" : ""}" role="switch" aria-checked="${inStock}" data-id="${id}"></div>`+
      `</div>`;
    }).join("");
    $("availCount").textContent = `${list.length} flavor${list.length === 1 ? "" : "s"}`;
  }
  $("flavorList").addEventListener("click", (e) => {
    const sw = e.target.closest(".switch"); if (!sw) return;
    const id = sw.dataset.id, nowOn = !sw.classList.contains("on");
    S.setAvailable(id, nowOn);
    sw.classList.toggle("on", nowOn); sw.setAttribute("aria-checked", String(nowOn));
    const row = sw.closest(".frow");
    row.classList.toggle("off", !nowOn);
    row.querySelector(".state").textContent = nowOn ? "In stock" : "Out";
  });
  $("availSearch").addEventListener("input", renderAvailability);

  // ============================================================
  //  ADD FLAVOR
  // ============================================================
  function buildCategorySelect(){
    const sel = $("addCategory");
    if (sel.children.length) return; // build once
    sel.innerHTML = CATS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    sel.value = "fruit";
  }
  function buildSwatches(){
    const box = $("swatches");
    if (box.children.length) return;
    box.innerHTML = SWATCH_HUES.map(h =>
      `<span class="swatch" data-hue="${h}" style="background:hsl(${h} 68% 52%)" title="hue ${h}"></span>`).join("");
    box.addEventListener("click", (e) => {
      const sw = e.target.closest(".swatch"); if (!sw) return;
      $("addHue").value = sw.dataset.hue; updatePreview();
    });
  }
  const icedSwitch = $("addIced");
  icedSwitch.addEventListener("click", () => {
    const on = !icedSwitch.classList.contains("on");
    icedSwitch.classList.toggle("on", on); icedSwitch.setAttribute("aria-checked", String(on));
  });
  icedSwitch.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter"){ e.preventDefault(); icedSwitch.click(); } });

  function updatePreview(){
    const name = $("addName").value.trim() || "New Flavor";
    const hue = Number($("addHue").value);
    const catId = $("addCategory").value || "other";
    const cat = CATMAP[catId] || { id:catId, hue };
    const params = resolveParamsFromSpec({ h: hue }, cat);
    const box = $("previewPod");
    box.innerHTML = podSVG({ id:"preview", name, params });
    box.style.setProperty("--pvh", hue);
    $("previewName").textContent = name;
    $("previewFile").textContent = `pods/${slug(name) || "new-flavor"}.png`;
  }
  ["addName"].forEach(id => $(id).addEventListener("input", updatePreview));
  $("addHue").addEventListener("input", updatePreview);
  $("addCategory").addEventListener("change", updatePreview);

  $("addBtn").addEventListener("click", () => {
    const name = $("addName").value.trim();
    if (!name) return setMsg($("addMsg"), "Enter a flavor name.", "bad");
    const res = S.addCustomFlavor({
      name,
      profile: $("addProfile").value,
      category: $("addCategory").value,
      iced: icedSwitch.classList.contains("on"),
      hue: Number($("addHue").value),
    });
    if (!res.ok) return setMsg($("addMsg"), res.error, "bad");
    setMsg($("addMsg"), `Added “${name}”. Add pods/${res.id}.png later for a real photo.`, "ok");
    $("addName").value = ""; $("addProfile").value = "";
    icedSwitch.classList.remove("on"); icedSwitch.setAttribute("aria-checked", "false");
    updatePreview();
    renderCustomList(); renderAvailability();
  });

  function renderCustomList(){
    const customs = S.getCustomFlavors();
    $("customEmpty").hidden = customs.length > 0;
    $("customList").innerHTML = customs.map(c => {
      const id = slug(c.name), catName = (CATMAP[c.category] || {}).name || c.category;
      return `<div class="mini-row">`+
        `<div class="thumb" style="width:26px;height:44px">${thumbFor({ name:c.name, category:c.category, custom:true, hue:c.hue, sat:c.sat, dark:c.dark })}</div>`+
        `<div class="grow"><div class="rname">${esc(c.name)}</div><div class="rsub">${esc(catName)} · pods/${id}.png</div></div>`+
        `<button class="btn danger" data-del="${id}">Delete</button>`+
      `</div>`;
    }).join("");
  }
  $("customList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    S.removeCustomFlavor(b.dataset.del);
    renderCustomList(); renderAvailability();
  });

  // ============================================================
  //  PASSCODES
  // ============================================================
  function renderPeople(){
    const people = S.listPeople();
    $("peopleList").innerHTML = people.map(p =>
      `<div class="mini-row"><div class="grow"><div class="rname">${esc(p.name)}</div><div class="rsub">Code ••••••</div></div>`+
      `<button class="btn danger" data-remove="${p.id}"${people.length <= 1 ? " disabled" : ""}>Remove</button></div>`
    ).join("");
  }
  $("peopleList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]"); if (!b) return;
    const res = S.removePerson(b.dataset.remove);
    if (!res.ok) return setMsg($("passMsg"), res.error, "bad");
    setMsg($("passMsg"), "", ""); renderPeople();
  });
  async function addPerson(){
    const name = $("pName").value.trim(), code = $("pCode").value;
    const res = await S.addPerson(name || "Staff", code);
    if (!res.ok) return setMsg($("passMsg"), res.error, "bad");
    setMsg($("passMsg"), `Added ${res.person.name}.`, "ok");
    $("pName").value = ""; $("pCode").value = "";
    renderPeople();
  }
  $("pAddBtn").addEventListener("click", addPerson);
  $("pCode").addEventListener("keydown", (e) => { if (e.key === "Enter") addPerson(); });
})();
