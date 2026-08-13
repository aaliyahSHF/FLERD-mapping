
# Flerd Pasture Tracker

Hi!!!!!!! - Aaliyah :) 

This Leaflet + GitHub + Google Sheets masterpiece of a pasture tracker is for tracking the Flerd as the free graze across the pastures at the home farm. 

## Features

- SHF map image as the base map (using Leaflet).
- Separate colored pasture boundaries with no pasture-name labels on the map (Choropleth map) .
- Record a new location by tapping the map.
- Automatically records the current date and time.
- Automatically determines the pasture from the tapped coordinates (which are determined via pixel).
- Optional addition of notes for each location.
- Alternating black cow and sheep silhouette pins :)
- Most recent pin is highlighted.
- Full historical movement path is shown lightly.
- Last 7 days are emphasized with a heavier path.
- Edit mode lets you select an existing pin, drag it to a more accurate location, and save the change.
- Existing pins can also have their date, time, and notes corrected.
- Google Sheets can be used as the shared source of data. They are synced up. 
- Map -> Google Sheets: new pins and edited pins are written to the sheet, with x,y axis coordinates
- Google Sheets -> Map: the website polls the sheet every 15 seconds and reflects spreadsheet edits. Also places a pin in the middle of the pasture (can come back to readjust later)
- Stable IDs prevent moving an existing pin from creating a duplicate row.
- Local CSV fallback is included for development/offline-ish use.
- Desktop/mobile layout.

## Files

- `index.html` — page structure.
- `styles.css` — desktop/mobile styling.
- `app.js` — Leaflet map, pins, paths, recording, editing, and sync.
- `pastures.js` — pasture polygons and shapes & such. Edit this to adjust fence lines.
- `google-apps-script.gs` — Google Sheets backend.
- `SHF map.png` — farm map screenshot
- `FLERD tracking data - Log.csv` — local fallback data

## Google Sheets setup


`Date | Time | Pasture | Map X | Map Y | Notes | ID | Updated At`

The Apps Script will create IDs for existing rows if they are blank.

### Apps Script (if new Google Sheet)

1. Create/open the Google Sheet.
2. Extensions -> Apps Script.
3. Paste `google-apps-script.gs` into `Code.gs`.
4. Set `SHEET ID` and `SHEET NAME`.
5. Deploy as a Web app.
6. Execute as: Me.
7. Who has access: Anyone.
8. Copy the URL.
9. Put the URL into `CONFIG.APPS_SCRIPT_URL` in `app.js`.

### Important sync behavior

The site sync up with Google Sheets every 15 seconds rather than using a true live push connection. If the sheet changes, the map normally reflects the change within 15 seconds.

If two people edit the same record at the same time, the most recent save wins.

The simple `Anyone` Apps Script deployment is convenient for sharing & multiple devices, but not private. Anyone who obtains the web-app URL could potentially submit data. For a private production deployment, one couldddd add authentication/access control.

## Pasture boundary accuracy

`pastures.js` contains an approximate visual transfer of the pasture boundaries...based on boundaries set on Pasture Maps website. Refine the polygon vertices there (pastures.js) if you want the boundaries to match exactly.
