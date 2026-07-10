/* ============================================================
   Foger Switch — kiosk store
   Single source of truth for the on-device admin state, kept in
   localStorage so the carousel and the admin panel (same origin)
   share it automatically. Exposed as window.KioskStore.

     foger.availability  { [flavorId]: false }   absent/true = in stock
     foger.customFlavors  [ {name,profile,category,iced,hue,sat?,dark?} ]
     foger.passcodes      { people:[ {id,name,hash} ] }  SHA-256, no plaintext

   NOTE: this is light, on-device security by design — anyone with the
   physical device and dev tools can read/bypass it. Fine for gating a
   countertop kiosk; it is not real authentication.
   ============================================================ */
(() => {
  "use strict";

  const K_AVAIL  = "foger.availability";
  const K_CUSTOM = "foger.customFlavors";
  const K_PASS   = "foger.passcodes";
  const SALT     = "foger-switch-kiosk-v1";  // fixed app salt (light security)

  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

  const read = (key, dflt) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? dflt : v; } catch(e){ return dflt; } };
  const write = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch(e){ return false; } };

  // ---------- availability ----------
  function getAvailability(){ return read(K_AVAIL, {}); }
  function isAvailable(id){ return getAvailability()[id] !== false; }
  function setAvailable(id, inStock){
    const a = getAvailability();
    if (inStock) delete a[id]; else a[id] = false;
    write(K_AVAIL, a);
  }

  // ---------- custom (admin-added) flavors ----------
  function getCustomFlavors(){ const list = read(K_CUSTOM, []); return Array.isArray(list) ? list : []; }
  function customId(f){ return slug(f.name); }
  function addCustomFlavor(f){
    const list = getCustomFlavors();
    const id = slug(f.name || "");
    if (!id) return { ok:false, error:"Name is required." };
    if (list.some(x => slug(x.name) === id)) return { ok:false, error:"A custom flavor with that name already exists." };
    list.push({
      name: f.name.trim(),
      profile: (f.profile || "").trim(),
      category: f.category || "other",
      iced: !!f.iced,
      hue: Number(f.hue) || 0,
      sat: f.sat != null ? Number(f.sat) : undefined,
      dark: f.dark != null ? !!f.dark : undefined,
    });
    write(K_CUSTOM, list);
    return { ok:true, id };
  }
  function updateCustomFlavor(id, patch){
    const list = getCustomFlavors();
    const i = list.findIndex(x => slug(x.name) === id);
    if (i < 0) return { ok:false, error:"Not found." };
    // if the name changes, guard against colliding with another custom flavor
    if (patch.name){
      const newId = slug(patch.name);
      if (newId !== id && list.some(x => slug(x.name) === newId)) return { ok:false, error:"Another custom flavor already uses that name." };
    }
    list[i] = { ...list[i], ...patch };
    write(K_CUSTOM, list);
    return { ok:true, id: slug(list[i].name) };
  }
  function removeCustomFlavor(id){
    const list = getCustomFlavors().filter(x => slug(x.name) !== id);
    write(K_CUSTOM, list);
  }

  // ---------- passcodes ----------
  async function sha256Hex(str){
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
  }
  const hashCode = (code) => sha256Hex(SALT + "|" + code);

  function getPass(){ const p = read(K_PASS, { people:[] }); return p && Array.isArray(p.people) ? p : { people:[] }; }
  function hasPasscodes(){ return getPass().people.length > 0; }
  function listPeople(){ return getPass().people.map(p => ({ id:p.id, name:p.name })); }

  function makeId(){
    // client-side id; collisions are astronomically unlikely and harmless here
    return "p" + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36);
  }

  async function addPerson(name, code){
    if (!/^\d{6}$/.test(code)) return { ok:false, error:"Passcode must be exactly 6 digits." };
    const p = getPass();
    if (p.people.length >= 12) return { ok:false, error:"Maximum of 12 passcodes reached." };
    const hash = await hashCode(code);
    if (p.people.some(x => x.hash === hash)) return { ok:false, error:"That passcode is already in use." };
    const person = { id: makeId(), name: (name || "Staff").trim() || "Staff", hash };
    p.people.push(person);
    write(K_PASS, p);
    return { ok:true, person:{ id:person.id, name:person.name } };
  }

  function removePerson(id){
    const p = getPass();
    if (p.people.length <= 1) return { ok:false, error:"Can't remove the last passcode — you'd be locked out." };
    p.people = p.people.filter(x => x.id !== id);
    write(K_PASS, p);
    return { ok:true };
  }

  async function verify(code){
    if (!/^\d{6}$/.test(code)) return null;
    const hash = await hashCode(code);
    const person = getPass().people.find(x => x.hash === hash);
    return person ? { id:person.id, name:person.name } : null;
  }

  window.KioskStore = {
    KEYS: { availability:K_AVAIL, customFlavors:K_CUSTOM, passcodes:K_PASS },
    slug,
    getAvailability, isAvailable, setAvailable,
    getCustomFlavors, customId, addCustomFlavor, updateCustomFlavor, removeCustomFlavor,
    hasPasscodes, listPeople, addPerson, removePerson, verify,
  };
})();
