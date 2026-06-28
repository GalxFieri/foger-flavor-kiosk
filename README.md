# Foger Switch — Flavor Kiosk

A self-contained, **offline** touchscreen menu for the ~90 Foger Switch flavors.
Customers scroll a holographic flavor grid, search, filter by category, and tap a
flavor to zoom into its flavor-profile. Runs fullscreen in any browser — no
internet, no server software, no accounts.

```
foger-flavor-kiosk/
  index.html      ← open this
  styles.css
  app.js
  flavors.json    ← THE ONLY FILE YOU EDIT to change flavors
  fonts/          ← bundled fonts (works offline)
  README.md
```

---

## ⚠️ Verify the flavor list before launch

`flavors.json` was drafted from public sources and **has not been checked against
your actual stock**. Before putting the kiosk on the counter, read through it and
fix any names, categories, or descriptions. See "Editing flavors" below.

---

## Editing flavors

Open `flavors.json` in any text editor (Notepad works). Each flavor looks like:

```json
{ "name": "Watermelon Ice", "category": "frozen", "profile": "Classic candied watermelon on a wave of cold ice." }
```

- **Add a flavor:** copy a line, change the values, keep the commas correct.
- **Remove a flavor:** delete its line.
- **Edit a description:** change the `profile` text.
- **category** must match one of the ids in the `categories` list at the top
  (`fruit`, `frozen`, `sour`, `beverage`, `candy`, `dessert`, `mint`, `tobacco`,
  `other`). To add a new category, add an entry to `categories` with an `id`,
  `name`, and a `hue` (0–360 color wheel value) — then use that `id` on flavors.

The grid, search, filters, count, and printable sheet all update automatically —
no other file needs touching. (Tip: paste the file into a JSON validator if the
page won't load after an edit; a missing comma is the usual culprit.)

---

## Running it

The kiosk must be **served from a folder**, not opened as a bare `file://` page
(browsers block `flavors.json` from loading over `file://`).

### Quick preview on a PC
- Easiest: install Python, then in this folder run `python -m http.server 8000`
  and open `http://localhost:8000`.
- Or use any static-file server / the VS Code "Live Server" extension.

### Android tablet (recommended hardware)
1. Copy this folder onto the tablet.
2. Install **Fully Kiosk Browser** (free) from the Play Store.
3. Set its Start URL to the local `index.html` (Fully can serve local files), or
   point it at a tiny local server app. Enable **fullscreen / kiosk lock**, screen
   always-on, and disable the address bar.
4. Mount the tablet (see parts list).

### Raspberry Pi (alternative)
1. Flash Raspberry Pi OS, connect the touchscreen.
2. Serve the folder (e.g. `python3 -m http.server 8000`).
3. Launch Chromium in kiosk mode on boot:
   `chromium-browser --kiosk --incognito http://localhost:8000`
   (add to autostart so it opens on power-up).

---

## Printable booklet (free backup)

Open the kiosk in a browser and print (Ctrl/Cmd-P). A dedicated print stylesheet
turns the same flavor data into a clean black-and-white 3-column sheet — laminate
it as a counter backup or for when the screen is busy.

---

## Suggested hardware

**Primary — budget Android tablet (≈ $105–180):**
- 10" Android tablet, 1280×800 or better — ~$90–140
- Mount, pick one:
  - Low-profile desktop tablet stand — ~$15–30, **or**
  - Quad-Lock-style adapter + strong suction-cup mount onto the glass display
    top — ~$25–40 (clean, near-flush look)
- No locking enclosure needed (kiosk sits on top of the staffed display cases).

**Alternative — fixed appliance (≈ $150–210):**
- Raspberry Pi 4 (2GB+) — ~$55–80
- Official 7" (or 10") touchscreen — ~$70–110
- Slim stand / enclosure — ~$25–40
- microSD + power — ~$25

---

## Customizing the look

- **Idle timeout:** change `IDLE_MS` at the top of `app.js` (default 60000 ms).
- **Store name / wording:** edit the brand and attract-screen text in `index.html`.
- **Colors:** the holographic palette and per-category hues live in `styles.css`
  (`--holo`) and the `categories` hues in `flavors.json`.
