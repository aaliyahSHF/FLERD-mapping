/*
  Flerd Pasture Tracker
  Leaflet + GitHub Pages + Google Sheets/Apps Script.

  The map uses pixel coordinates from assets/SHF map.png:
    Map X = image column (0 -> 724)
    Map Y = image row    (0 -> 582)

  Google Sheets is the source of truth when APPS_SCRIPT_URL is configured.
  The app polls the sheet every 15 seconds. Map-created records are added to
  the Sheet, and existing pins can be dragged and saved back to the same row.
*/

const CONFIG = {
  MAP_IMAGE: "SHF map.png",
  LOCAL_CSV: "FLERD tracking data - Log.csv",
  APPS_SCRIPT_URL: "",
  DATA_YEAR: 2026,
  IMAGE_WIDTH: 724,
  IMAGE_HEIGHT: 582,
  PASTURE_FILL_OPACITY: 0.12,
  PASTURE_WEIGHT: 2.5,
  SYNC_INTERVAL_MS: 15000,
  SHOW_APPROXIMATE_OLD_CSV_POINTS: true
};

let map;
let markerLayer = L.layerGroup();
let pathLayer = L.layerGroup();
let pastureLayers = [];
let targetMarker = null;
let allRecords = [];
let selectedPoint = null;
let recordingMode = false;
let editMode = false;
let editingRecord = null;
let toastTimer = null;
let refreshInProgress = false;

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseDateTime(row) {
  const dateRaw = String(row.Date ?? "").trim();
  const timeRaw = String(row.Time ?? "").trim();
  if (!dateRaw) return null;

  const parts = dateRaw.split(/[\/-]/);
  if (parts.length < 2) return null;

  const month = Number(parts[0]);
  const day = Number(parts[1]);
  let year = Number(parts[2]) || CONFIG.DATA_YEAR;
  if (year < 100) year += 2000;

  let hour = 12;
  let minute = 0;
  const t = timeRaw.toUpperCase().trim();

  const hm = t.match(/(\d{1,2})(?::(\d{2}))?/);
  if (hm) {
    hour = Number(hm[1]);
    minute = Number(hm[2] || 0);
    if (t.includes("PM") && hour < 12) hour += 12;
    if (t.includes("AM") && hour === 12) hour = 0;
  } else if (t === "AM") {
    hour = 8;
  } else if (t === "PM") {
    hour = 18;
  }

  const dt = new Date(year, month - 1, day, hour, minute, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeRow(row, sourceIndex) {
  const x = Number(row["Map X"]);
  const y = Number(row["Map Y"]);
  return {
    sourceIndex,
    id: String(row.ID ?? "").trim(),
    date: String(row.Date ?? "").trim(),
    time: String(row.Time ?? "").trim(),
    pasture: String(row.Pasture ?? "").trim(),
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
    notes: String(row.Notes ?? "").trim(),
    updatedAt: String(row["Updated At"] ?? "").trim(),
    dateTime: parseDateTime(row),
    approximate: false
  };
}

function sortedRecords() {
  return allRecords.filter(r => r.dateTime).sort((a, b) => a.dateTime - b.dateTime);
}

function pastureAt(x, y) {
  for (const pasture of window.PASTURES) {
    const pts = pasture.polygon;
    let inside = false;

    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    if (inside) return pasture.id;
  }
  return "";
}

function centroidForPasture(id) {
  return window.PASTURE_CENTROIDS[String(id)] || null;
}

function iconSvg(kind) {
  if (kind === "cow") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="#000"><path d="M12 27c0-7 6-12 14-12h16c8 0 13 5 13 12v13c0 3-3 5-7 5H20c-5 0-8-3-8-7V27z"/><path d="M48 19h7l5-5 2 2-3 7h-8z"/><path d="M16 19l-4-6 2-2 7 5zM21 42v14h5V43zM39 42v14h5V43z"/><path d="M12 30H6v5h7z"/><circle cx="53" cy="25" r="1.5" fill="#fff"/></g></svg>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="#000"><path d="M10 32c0-10 9-18 21-18 9 0 18 5 21 12 5 0 8 3 8 8 0 5-4 8-9 8H19c-6 0-9-4-9-10z"/><path d="M46 28c4-7 10-8 14-5l-3 11-9 3z"/><path d="M18 42v14h5V43zM38 42v14h5V43z"/><path d="M11 27l-6-4-2 3 7 6z"/></g></svg>`;
}

function makeFlerdIcon(index, isLast, approximate = false) {
  const kind = index % 2 === 0 ? "cow" : "sheep";
  const size = isLast ? 40 : 30;
  const cls = `flerd-marker ${isLast ? "last-seen" : ""} ${approximate ? "approximate-marker" : ""}`;
  return L.divIcon({
    className: "",
    html: `<div class="${cls}" title="${kind}">${iconSvg(kind)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function formatDate(dt) {
  return dt ? dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown date";
}

function formatTime(dt, raw) {
  return dt ? dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : (raw || "Unknown time");
}

function recordPopup(record) {
  const approximate = record.approximate
    ? `<div class="popup-note"><strong>Approximate:</strong> this older CSV row had no Map X/Y, so it is shown at the pasture center.</div>`
    : "";
  const edit = record.id
    ? `<button class="popup-edit-btn" data-edit-id="${esc(record.id)}">Move / edit pin</button>`
    : `<div class="popup-note">Connect Google Sheets and refresh to give this record a stable ID.</div>`;

  return `<div class="popup-content">
    <strong>${esc(formatDate(record.dateTime))}</strong><br>
    ${esc(formatTime(record.dateTime, record.time))} · Pasture ${esc(record.pasture || "—")}
    ${record.notes ? `<div class="popup-notes">${esc(record.notes)}</div>` : ""}
    ${approximate}
    ${edit}
  </div>`;
}

function drawPastures() {
  pastureLayers.forEach(layer => map.removeLayer(layer));
  pastureLayers = [];

  const shown = new Set();
  for (const pasture of window.PASTURES) {
    const layer = L.polygon(pasture.polygon.map(([x, y]) => [y, x]), {
      color: "#111",
      weight: CONFIG.PASTURE_WEIGHT,
      opacity: 0.8,
      fillColor: pasture.color,
      fillOpacity: CONFIG.PASTURE_FILL_OPACITY,
      interactive: false
    }).addTo(map);
    pastureLayers.push(layer);
    shown.add(pasture.id);
  }

  $("pastureLegend").innerHTML = [...shown].map(id => {
    const pasture = window.PASTURES.find(p => p.id === id);
    return `<div class="pasture-key"><span class="pasture-swatch" style="background:${pasture.color}"></span><span>Pasture ${esc(id)}</span></div>`;
  }).join("");
}

function addApproximatePoints(records) {
  if (!CONFIG.SHOW_APPROXIMATE_OLD_CSV_POINTS) return;
  for (const r of records) {
    if (r.x !== null && r.y !== null) continue;
    const center = centroidForPasture(r.pasture);
    if (!center) continue;
    r.x = center[0];
    r.y = center[1];
    r.approximate = true;
  }
}

function drawRecords() {
  markerLayer.clearLayers();
  pathLayer.clearLayers();

  const records = sortedRecords();
  if (!records.length) {
    $("lastSeenText").textContent = "No location yet";
    $("sevenDayText").textContent = "No recent locations yet";
    return;
  }

  addApproximatePoints(records);
  const last = records.at(-1);
  const cutoff = new Date(last.dateTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = records.filter(r => r.dateTime >= cutoff && r.x !== null && r.y !== null);
  const fullPoints = records.filter(r => r.x !== null && r.y !== null).map(r => [r.y, r.x]);
  const recentPoints = recent.map(r => [r.y, r.x]);

  if (fullPoints.length >= 2) {
    L.polyline(fullPoints, { color: "#111", weight: 2, opacity: 0.26, dashArray: "5 7", lineJoin: "round" }).addTo(pathLayer);
  }
  if (recentPoints.length >= 2) {
    L.polyline(recentPoints, { color: "#111", weight: 5, opacity: 0.9, lineJoin: "round", lineCap: "round" }).addTo(pathLayer);
  }

  records.forEach((record, index) => {
    if (record.x === null || record.y === null) return;
    const isLast = record === last;
    const marker = L.marker([record.y, record.x], {
      icon: makeFlerdIcon(index, isLast, record.approximate),
      zIndexOffset: isLast ? 1000 : index
    });
    marker.recordId = record.id;
    marker.bindPopup(recordPopup(record)).addTo(markerLayer);
    marker.on("click", () => {
      if (editMode && record.id) startEditingRecord(record);
    });
  });

  $("lastSeenText").textContent = `${formatDate(last.dateTime)} · ${formatTime(last.dateTime, last.time)} · Pasture ${last.pasture || "—"}${last.approximate ? " (approx.)" : ""}`;
  $("sevenDayText").textContent = `${recent.length} documented location${recent.length === 1 ? "" : "s"} in the last 7 days`;
}

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function setRecordingMode(active) {
  recordingMode = active;
  $("recordBtn").classList.toggle("recording", active);
  $("recordBtn").textContent = active ? "Tap map to place pin" : "＋ Record location";
  if (active) setEditMode(false);
  if (!active) {
    selectedPoint = null;
    if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
    $("selectedLocation").classList.add("hidden");
    $("saveRecord").disabled = true;
    $("tapHint").textContent = "Tap the map to choose a location.";
  }
}

function setEditMode(active) {
  editMode = active;
  $("editBtn").classList.toggle("active", active);
  $("editBtn").textContent = active ? "✓ Editing mode" : "✎ Edit pins";
  if (active) {
    setRecordingMode(false);
    showToast("Tap a pin to move or edit it.");
  } else if (editingRecord) {
    closeEditPanel();
  }
}

function choosePoint(latlng) {
  const x = Math.round(latlng.lng);
  const y = Math.round(latlng.lat);
  selectedPoint = { x, y, pasture: pastureAt(x, y) };

  if (targetMarker) map.removeLayer(targetMarker);
  targetMarker = L.marker([y, x], {
    icon: L.divIcon({ className: "", html: '<div class="record-target"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    zIndexOffset: 2000
  }).addTo(map);

  $("selectedLocation").classList.remove("hidden");
  $("selectedLocation").innerHTML = `<strong>Selected:</strong> X ${x}, Y ${y}${selectedPoint.pasture ? ` · <strong>Pasture ${esc(selectedPoint.pasture)}</strong>` : " · Outside the defined pasture boundaries"}`;
  $("saveRecord").disabled = false;
  $("tapHint").textContent = "Location selected. Add an optional note, then save.";
}

function toDateInputValue(record) {
  if (!record.dateTime) return "";
  const y = record.dateTime.getFullYear();
  const m = String(record.dateTime.getMonth() + 1).padStart(2, "0");
  const d = String(record.dateTime.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toTimeInputValue(record) {
  if (!record.dateTime) return "";
  return `${String(record.dateTime.getHours()).padStart(2, "0")}:${String(record.dateTime.getMinutes()).padStart(2, "0")}`;
}

function buildNewRow() {
  const now = new Date();
  return {
    ID: "",
    Date: `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`,
    Time: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    Pasture: selectedPoint?.pasture || "",
    "Map X": selectedPoint?.x ?? "",
    "Map Y": selectedPoint?.y ?? "",
    Notes: $("notes").value.trim()
  };
}

function submitToAppsScript(row) {
  if (!CONFIG.APPS_SCRIPT_URL) return Promise.reject(new Error("Google Sheets URL is not configured."));

  return new Promise((resolve) => {
    const frameName = "appsScriptSink";
    let frame = document.getElementById(frameName);
    if (!frame) {
      frame = document.createElement("iframe");
      frame.name = frameName;
      frame.id = frameName;
      frame.hidden = true;
      document.body.appendChild(frame);
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = CONFIG.APPS_SCRIPT_URL;
    form.target = frameName;
    form.hidden = true;

    const input = document.createElement("input");
    input.name = "payload";
    input.value = JSON.stringify(row);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();

    // Apps Script web apps do not expose a convenient CORS response to the page
    // in this setup, so the next scheduled GET verifies the write.
    setTimeout(resolve, 900);
  });
}

function loadCsvText(url) {
  return fetch(url, { cache: "no-store" }).then(r => {
    if (!r.ok) throw new Error(`Could not load ${url}`);
    return r.text();
  });
}

function parseCsvText(text) {
  const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return parsed.data.map((row, i) => normalizeRow(row, i));
}

function loadFromAppsScript() {
  return new Promise((resolve, reject) => {
    const callback = `flerdCallback_${Date.now()}`;
    const script = document.createElement("script");

    window[callback] = payload => {
      cleanup();
      if (!Array.isArray(payload)) return reject(new Error("Unexpected Google Sheets response."));
      resolve(payload.map((row, i) => normalizeRow(row, i)));
    };

    function cleanup() {
      delete window[callback];
      script.remove();
    }

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not reach the Google Sheets endpoint."));
    };

    script.src = `${CONFIG.APPS_SCRIPT_URL}?callback=${encodeURIComponent(callback)}&t=${Date.now()}`;
    document.body.appendChild(script);
  });
}

async function loadRecords() {
  if (CONFIG.APPS_SCRIPT_URL) {
    try {
      const records = await loadFromAppsScript();
      $("syncStatus").textContent = `Google Sheets synced · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
      return records;
    } catch (error) {
      console.warn(error);
      $("syncStatus").textContent = "Google Sheets unavailable · using local CSV";
    }
  }

  try {
    const text = await loadCsvText(CONFIG.LOCAL_CSV);
    $("syncStatus").textContent = "Using local CSV";
    return parseCsvText(text);
  } catch (error) {
    console.error(error);
    $("syncStatus").textContent = "No location data found";
    return [];
  }
}

function recordSignature(r) {
  return [r.id, r.date, r.time, r.pasture, r.x, r.y, r.notes, r.updatedAt].join("~");
}

async function refresh(forceDraw = false) {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const before = allRecords.map(recordSignature).join("|");
    const next = await loadRecords();
    const after = next.map(recordSignature).join("|");
    allRecords = next;
    if (forceDraw || before !== after) drawRecords();
  } finally {
    refreshInProgress = false;
  }
}

function findRecordById(id) {
  return allRecords.find(r => r.id === id) || null;
}

function startEditingRecord(record) {
  if (!record.id) {
    showToast("This record has no Google Sheet ID yet.");
    return;
  }

  editingRecord = record;
  selectedPoint = { x: record.x, y: record.y, pasture: record.pasture };

  if (targetMarker) map.removeLayer(targetMarker);
  targetMarker = L.marker([record.y, record.x], {
    draggable: true,
    icon: makeFlerdIcon(record.sourceIndex, record === sortedRecords().at(-1), record.approximate),
    zIndexOffset: 2500
  }).addTo(map);

  targetMarker.bindPopup("Drag this pin to the accurate location.").openPopup();
  targetMarker.on("drag", () => {
    const p = targetMarker.getLatLng();
    const x = Math.round(p.lng), y = Math.round(p.lat);
    selectedPoint = { x, y, pasture: pastureAt(x, y) };
    $("editSelectedLocation").textContent = `X ${x}, Y ${y} · Pasture ${selectedPoint.pasture || "outside boundary"}`;
  });

  $("editSelectedLocation").textContent = `X ${record.x}, Y ${record.y} · Pasture ${record.pasture || "—"}`;
  $("editDate").value = toDateInputValue(record);
  $("editTime").value = toTimeInputValue(record);
  $("editNotes").value = record.notes || "";
  $("editPanel").classList.remove("hidden");
}

function closeEditPanel() {
  $("editPanel").classList.add("hidden");
  editingRecord = null;
  if (targetMarker) {
    map.removeLayer(targetMarker);
    targetMarker = null;
  }
}

function formatDateForSheet(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

function formatTimeForSheet(value) {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

async function saveEditedRecord() {
  if (!editingRecord || !selectedPoint) return;
  if (!CONFIG.APPS_SCRIPT_URL) {
    showToast("Connect Google Sheets to permanently edit a pin.");
    return;
  }

  const row = {
    ID: editingRecord.id,
    Date: formatDateForSheet($("editDate").value) || editingRecord.date,
    Time: formatTimeForSheet($("editTime").value) || editingRecord.time,
    Pasture: selectedPoint.pasture || editingRecord.pasture || "",
    "Map X": selectedPoint.x,
    "Map Y": selectedPoint.y,
    Notes: $("editNotes").value.trim()
  };

  $("saveEdit").disabled = true;
  $("saveEdit").textContent = "Saving…";
  try {
    await submitToAppsScript(row);
    closeEditPanel();
    setEditMode(false);
    showToast("Pin updated. Checking Google Sheets…");
    setTimeout(() => refresh(true), 1200);
  } catch (error) {
    console.error(error);
    showToast("Could not update the pin.");
  } finally {
    $("saveEdit").disabled = false;
    $("saveEdit").textContent = "Save pin position";
  }
}

async function saveLocation() {
  if (!selectedPoint) return;
  const row = buildNewRow();

  $("saveRecord").disabled = true;
  $("saveRecord").textContent = "Saving…";

  if (!CONFIG.APPS_SCRIPT_URL) {
    allRecords.push(normalizeRow(row, allRecords.length));
    drawRecords();
    showToast("Saved for this session. Add your Apps Script URL for permanent sync.");
    closeRecordPanel();
    return;
  }

  try {
    await submitToAppsScript(row);
    closeRecordPanel();
    showToast("Location sent to Google Sheets. Verifying…");
    setTimeout(() => refresh(true), 1200);
  } catch (error) {
    console.error(error);
    showToast("Could not save the location.");
  } finally {
    $("saveRecord").disabled = false;
    $("saveRecord").textContent = "Save location";
  }
}

function closeRecordPanel() {
  $("recordPanel").classList.add("hidden");
  $("notes").value = "";
  setRecordingMode(false);
}

function initializeMap() {
  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 4,
    zoomControl: true,
    attributionControl: false,
    zoomSnap: 0.25
  });

  const bounds = [[0, 0], [CONFIG.IMAGE_HEIGHT, CONFIG.IMAGE_WIDTH]];
  L.imageOverlay(CONFIG.MAP_IMAGE, bounds, { opacity: 1, interactive: false }).addTo(map);
  map.fitBounds(bounds);
  drawPastures();
  pathLayer.addTo(map);
  markerLayer.addTo(map);

  map.on("click", event => {
    if (recordingMode) {
      choosePoint(event.latlng);
      $("recordPanel").classList.remove("hidden");
    }
  });
}

function wireUi() {
  $("recordBtn").addEventListener("click", () => {
    if (recordingMode) {
      setRecordingMode(false);
      showToast("Record mode cancelled.");
    } else {
      setRecordingMode(true);
      showToast("Tap the map where the Flerd is.");
    }
  });

  $("editBtn").addEventListener("click", () => setEditMode(!editMode));
  $("closeRecord").addEventListener("click", closeRecordPanel);
  $("cancelRecord").addEventListener("click", closeRecordPanel);
  $("saveRecord").addEventListener("click", saveLocation);
  $("closeEdit").addEventListener("click", closeEditPanel);
  $("cancelEditBtn").addEventListener("click", closeEditPanel);
  $("saveEdit").addEventListener("click", saveEditedRecord);

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-id]");
    if (!button) return;
    const record = findRecordById(button.dataset.editId);
    if (record) startEditingRecord(record);
  });

  $("recordPanel").addEventListener("click", event => {
    if (event.target === $("recordPanel")) closeRecordPanel();
  });
  $("editPanel").addEventListener("click", event => {
    if (event.target === $("editPanel")) closeEditPanel();
  });
}

async function start() {
  initializeMap();
  wireUi();
  await refresh(true);
  setInterval(() => refresh(false), CONFIG.SYNC_INTERVAL_MS);
}

start();
