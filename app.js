/*
  Flerd Pasture Tracker
  Leaflet + GitHub Pages + Google Sheets/Apps Script.

  The map uses pixel coordinates from assets/SHF map.png:
    Map X = image column (0 -> 724)
    Map Y = image row    (0 -> 582)

*/

const CONFIG = {
  MAP_IMAGES: ["assets/SHF map.png", "SHF map.png"],
  CSV_FILES: ["data/flerd-log.csv", "flerd-log.csv"],

  // Paste your deployed Google Apps Script /exec URL here.
  APPS_SCRIPT_URL: "",

  COW_ICON: "cow.svg",
  SHEEP_ICON: "sheep.svg",

  DATA_YEAR: 2026,
  IMAGE_WIDTH: 724,
  IMAGE_HEIGHT: 582,

  PASTURE_FILL_OPACITY: 0.12,
  PASTURE_WEIGHT: 2,

  // Thin movement lines.
  FULL_PATH_WEIGHT: 1.2,
  FULL_PATH_OPACITY: 0.24,

  SEVEN_DAY_PATH_WEIGHT: 2.2,
  SEVEN_DAY_PATH_OPACITY: 0.88,

  SYNC_INTERVAL_MS: 15000,

  // Old rows without Map X/Y are shown at the pasture centroid.
  SHOW_APPROXIMATE_OLD_POINTS: true
};

let map;
let markerLayer = L.layerGroup();
let pathLayer = L.layerGroup();
let pastureLayer = L.layerGroup();
let editingPastureLayer = L.layerGroup();

let pastureLayers = [];
let pastureVertexMarkers = [];

let targetMarker = null;

let allRecords = [];
let selectedPoint = null;
let editingRecord = null;

let recordingMode = false;
let editMode = false;
let pastureEditMode = false;

let selectedPastureFilter = null;
let selectedFilterType = null;

// Historical date lookup. Format: YYYY-MM-DD.
let selectedPastPathDate = null;

let pastureLegendOpen = false;
let toastTimer = null;
let refreshInProgress = false;

let pastureData = [];
let pastureEditBackup = null;
let mapImageUrl = null;

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -------------------------------------------------------
   STARTUP
------------------------------------------------------- */

async function start() {
  pastureData = loadPasturesFromStorage() || deepCopyPastures(window.PASTURES || []);

  initializeMap();
  wireUi();

  await loadMapImage();
  drawPastures();
  await refresh(true);

  setInterval(() => refresh(false), CONFIG.SYNC_INTERVAL_MS);
}

function deepCopyPastures(value) {
  return JSON.parse(JSON.stringify(value));
}

/* -------------------------------------------------------
   MAP
------------------------------------------------------- */

function initializeMap() {
  map = L.map("map", {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 4,
    zoomControl: true,
    attributionControl: false,
    zoomSnap: 0.25
  });

  markerLayer.addTo(map);
  pathLayer.addTo(map);
  pastureLayer.addTo(map);
  editingPastureLayer.addTo(map);

  map.on("click", event => {
    if (recordingMode) {
      choosePoint(event.latlng);
      $("recordPanel").classList.remove("hidden");
    }
  });
}

async function loadMapImage() {
  for (const url of CONFIG.MAP_IMAGES) {
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (response.ok) {
        mapImageUrl = url;
        break;
      }
    } catch (_) {}
  }

  if (!mapImageUrl) {
    mapImageUrl = CONFIG.MAP_IMAGES[0];
  }

  const bounds = [[0, 0], [CONFIG.IMAGE_HEIGHT, CONFIG.IMAGE_WIDTH]];

  L.imageOverlay(mapImageUrl, bounds, {
    opacity: 1,
    interactive: false
  }).addTo(map);

  map.fitBounds(bounds);
}

/* -------------------------------------------------------
   UI
------------------------------------------------------- */

function wireUi() {
  $("recordBtn").addEventListener("click", () => {
    setRecordingMode(!recordingMode);
  });

  $("editBtn").addEventListener("click", () => {
    setEditMode(!editMode);
  });

  $("editPasturesBtn").addEventListener("click", () => {
    setPastureEditMode(!pastureEditMode);
  });

  $("savePasturesBtn").addEventListener("click", savePastureBoundaries);

  $("cancelPasturesBtn").addEventListener("click", () => {
    restorePastures();
    setPastureEditMode(false);
    drawPastures();
    showToast("Pasture changes cancelled.");
  });

  $("closeRecord").addEventListener("click", closeRecordPanel);
  $("cancelRecord").addEventListener("click", closeRecordPanel);
  $("saveRecord").addEventListener("click", saveLocation);

  $("closeEdit").addEventListener("click", closeEditPanel);
  $("cancelEditBtn").addEventListener("click", closeEditPanel);
  $("saveEdit").addEventListener("click", saveEditedRecord);

  $("pastureToggle").addEventListener("click", () => {
    pastureLegendOpen = !pastureLegendOpen;
    renderPastureLegend();
  });

  $("pastPathShow").addEventListener("click", showPastPathLookup);
  $("pastPathClear").addEventListener("click", clearPastPathLookup);

  $("pastPathDate").addEventListener("keydown", event => {
    if (event.key === "Enter") showPastPathLookup();
  });

  $("pastPathDate").addEventListener("input", event => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) {
      event.target.value = digits;
    } else if (digits.length <= 4) {
      event.target.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    } else {
      event.target.value =
        `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    }
  });

  $("pastureLegend").addEventListener("click", event => {
    const button = event.target.closest("[data-pasture-filter]");
    if (!button) return;

    const id = button.dataset.pastureFilter;
    const type = button.dataset.filterType;

    if (type === "all") {
      selectedPastureFilter = null;
      selectedFilterType = null;
    } else {
      selectedPastureFilter = id;
      selectedFilterType = type;
    }

    drawEverything();
  });

  $("recordPanel").addEventListener("click", event => {
    if (event.target === $("recordPanel")) closeRecordPanel();
  });

  $("editPanel").addEventListener("click", event => {
    if (event.target === $("editPanel")) closeEditPanel();
  });

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-id]");
    if (!button) return;

    const record = findRecordById(button.dataset.editId);
    if (record) startEditingRecord(record);
  });
}

/* -------------------------------------------------------
   RECORD MODE
------------------------------------------------------- */

function setRecordingMode(active) {
  recordingMode = active;

  if (active) {
    setEditMode(false);
    setPastureEditMode(false);

    $("recordBtn").classList.add("recording");
    $("recordBtn").textContent = "Tap map to place pin";

    showToast("Tap the map where the Flerd is.");
  } else {
    $("recordBtn").classList.remove("recording");
    $("recordBtn").textContent = "＋ Record location";

    selectedPoint = null;

    if (targetMarker) {
      map.removeLayer(targetMarker);
      targetMarker = null;
    }

    $("selectedLocation").classList.add("hidden");
    $("saveRecord").disabled = true;
    $("tapHint").textContent = "Tap the map to choose a location.";
  }
}

function choosePoint(latlng) {
  const x = Math.round(latlng.lng);
  const y = Math.round(latlng.lat);

  selectedPoint = {
    x,
    y,
    pasture: pastureAt(x, y)
  };

  if (targetMarker) {
    map.removeLayer(targetMarker);
  }

  targetMarker = L.marker([y, x], {
    icon: L.divIcon({
      className: "",
      html: '<div class="record-target"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    }),
    zIndexOffset: 2000
  }).addTo(map);

  $("selectedLocation").classList.remove("hidden");
  $("selectedLocation").innerHTML =
    `<strong>Selected:</strong> X ${x}, Y ${y}` +
    (selectedPoint.pasture
      ? ` · <strong>Pasture ${esc(selectedPoint.pasture)}</strong>`
      : " · Outside the defined pasture boundaries");

  $("saveRecord").disabled = false;
  $("tapHint").textContent = "Location selected. Add an optional note, then save.";
}

function closeRecordPanel() {
  $("recordPanel").classList.add("hidden");

  if ($("notes")) {
    $("notes").value = "";
  }

  setRecordingMode(false);
}

/* -------------------------------------------------------
   EDIT PIN MODE
------------------------------------------------------- */

function setEditMode(active) {
  editMode = active;

  $("editBtn").classList.toggle("active", active);
  $("editBtn").textContent = active ? "✓ Editing pins" : "✎ Edit pins";

  if (active) {
    setRecordingMode(false);
    setPastureEditMode(false);
    showToast("Tap a pin to move or edit it.");
  } else if (editingRecord) {
    closeEditPanel();
  }

  drawMarkers();
}

function findRecordById(id) {
  return allRecords.find(record => record.id === id) || null;
}

function startEditingRecord(record) {
  if (!record.id) {
    showToast("This record has no Google Sheet ID yet.");
    return;
  }

  editingRecord = record;

  selectedPoint = {
    x: record.x,
    y: record.y,
    pasture: record.pasture
  };

  if (targetMarker) {
    map.removeLayer(targetMarker);
  }

  targetMarker = L.marker([record.y, record.x], {
    draggable: true,
    icon: makeFlerdIcon(
      record.sourceIndex,
      isLastRecord(record),
      record.approximate
    ),
    zIndexOffset: 2500
  }).addTo(map);

  targetMarker.bindPopup(
    "Drag this pin to the accurate location."
  ).openPopup();

  targetMarker.on("drag", () => {
    const p = targetMarker.getLatLng();

    selectedPoint = {
      x: Math.round(p.lng),
      y: Math.round(p.lat),
      pasture: pastureAt(
        Math.round(p.lng),
        Math.round(p.lat)
      )
    };

    $("editSelectedLocation").textContent =
      `X ${selectedPoint.x}, Y ${selectedPoint.y} · ` +
      `Pasture ${selectedPoint.pasture || "outside boundary"}`;
  });

  $("editSelectedLocation").textContent =
    `X ${record.x}, Y ${record.y} · Pasture ${record.pasture || "—"}`;

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

async function saveEditedRecord() {
  if (!editingRecord || !selectedPoint) return;

  const row = {
    ID: editingRecord.id,
    Date: formatDateForSheet($("editDate").value) || editingRecord.date,
    Time: formatTimeForSheet($("editTime").value) || editingRecord.time,
    Pasture: selectedPoint.pasture || "",
    "Map X": selectedPoint.x,
    "Map Y": selectedPoint.y,
    Notes: $("editNotes").value.trim()
  };

  $("saveEdit").disabled = true;
  $("saveEdit").textContent = "Saving…";

  try {
    if (CONFIG.APPS_SCRIPT_URL) {
      await submitToAppsScript(row);
      showToast("Pin updated. Checking Google Sheets…");
      closeEditPanel();
      setEditMode(false);
      setTimeout(() => refresh(true), 1200);
    } else {
      Object.assign(editingRecord, normalizeRow(row, editingRecord.sourceIndex));
      closeEditPanel();
      setEditMode(false);
      drawEverything();
      showToast("Pin updated locally. Add your Apps Script URL for Google Sheets sync.");
    }
  } catch (error) {
    console.error(error);
    showToast("Could not update the pin.");
  } finally {
    $("saveEdit").disabled = false;
    $("saveEdit").textContent = "Save pin position";
  }
}

/* -------------------------------------------------------
   NEW LOCATION
------------------------------------------------------- */

function buildNewRow() {
  const now = new Date();

  return {
    ID: "",
    Date: `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`,
    Time: now.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit"
    }),
    Pasture: selectedPoint?.pasture || "",
    "Map X": selectedPoint?.x ?? "",
    "Map Y": selectedPoint?.y ?? "",
    Notes: $("notes").value.trim()
  };
}

async function saveLocation() {
  if (!selectedPoint) return;

  const row = buildNewRow();

  $("saveRecord").disabled = true;
  $("saveRecord").textContent = "Saving…";

  try {
    if (CONFIG.APPS_SCRIPT_URL) {
      await submitToAppsScript(row);
      closeRecordPanel();
      showToast("Location sent to Google Sheets. Checking…");
      setTimeout(() => refresh(true), 1200);
    } else {
      allRecords.push(normalizeRow(row, allRecords.length));
      closeRecordPanel();
      drawEverything();
      showToast("Location saved locally. Add your Apps Script URL for Google Sheets sync.");
    }
  } catch (error) {
    console.error(error);
    showToast("Could not save the location.");
  } finally {
    $("saveRecord").disabled = false;
    $("saveRecord").textContent = "Save location";
  }
}

/* -------------------------------------------------------
   GOOGLE SHEETS
------------------------------------------------------- */

function submitToAppsScript(row) {
  if (!CONFIG.APPS_SCRIPT_URL) {
    return Promise.reject(
      new Error("Google Sheets URL is not configured.")
    );
  }

  return new Promise(resolve => {
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

    setTimeout(resolve, 900);
  });
}

function loadFromAppsScript() {
  return new Promise((resolve, reject) => {
    const callback =
      `flerdCallback_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    const script = document.createElement("script");

    window[callback] = payload => {
      cleanup();

      if (!Array.isArray(payload)) {
        reject(
          new Error("Unexpected Google Sheets response.")
        );
        return;
      }

      resolve(
        payload.map(
          (row, i) =>
            normalizeRow(row, i)
        )
      );
    };

    function cleanup() {
      delete window[callback];
      script.remove();
    }

    script.onerror = () => {
      cleanup();
      reject(
        new Error("Could not reach Google Sheets.")
      );
    };

    script.src =
      `${CONFIG.APPS_SCRIPT_URL}` +
      `?action=getLocations` +
      `&callback=${encodeURIComponent(callback)}` +
      `&t=${Date.now()}`;

    document.body.appendChild(script);
  });
}

/* -------------------------------------------------------
   CSV
------------------------------------------------------- */

async function loadCsvRecords() {
  for (const url of CONFIG.CSV_FILES) {
    try {
      const response =
        await fetch(url, { cache: "no-store" });

      if (!response.ok) continue;

      const text = await response.text();

      const parsed =
        Papa.parse(
          text.trim(),
          {
            header: true,
            skipEmptyLines: true
          }
        );

      return parsed.data.map(
        (row, i) =>
          normalizeRow(row, i)
      );

    } catch (error) {
      console.warn(
        `CSV load failed for ${url}`,
        error
      );
    }
  }

  return [];
}

/* -------------------------------------------------------
   LOAD / MERGE DATA
------------------------------------------------------- */

async function loadRecords() {
  let googleRows = [];
  let csvRows = [];

  if (CONFIG.APPS_SCRIPT_URL) {
    try {
      googleRows =
        await loadFromAppsScript();

      $("syncStatus").textContent =
        `Google Sheets synced · ${new Date().toLocaleTimeString(
          [],
          {
            hour: "numeric",
            minute: "2-digit"
          }
        )}`;
    } catch (error) {
      console.warn(error);

      $("syncStatus").textContent =
        "Google Sheets unavailable · using local data";
    }
  }

  csvRows =
    await loadCsvRecords();

  /*
    Google Sheet is preferred when both sources
    contain the same record, but CSV-only rows
    remain visible.
  */

  const merged = [];

  for (const record of csvRows) {
    merged.push(record);
  }

  for (const record of googleRows) {
    const existingIndex =
      merged.findIndex(
        existing =>
          (
            record.id &&
            existing.id &&
            record.id === existing.id
          ) ||

          (
            existing.date === record.date &&
            existing.time === record.time &&
            existing.pasture === record.pasture &&
            existing.x === record.x &&
            existing.y === record.y
          )
      );

    if (existingIndex >= 0) {
      merged[existingIndex] = record;
    } else {
      merged.push(record);
    }
  }

  /*
    If neither source worked, preserve whatever
    is already on screen.
  */

  if (
    googleRows.length === 0 &&
    csvRows.length === 0 &&
    allRecords.length > 0
  ) {
    return allRecords;
  }

  return merged;
}

function recordSignature(record) {
  return [
    record.id,
    record.date,
    record.time,
    record.pasture,
    record.x,
    record.y,
    record.notes,
    record.updatedAt
  ].join("~");
}

async function refresh(forceDraw = false) {
  if (refreshInProgress) return;

  refreshInProgress = true;

  try {
    const before =
      allRecords
        .map(recordSignature)
        .join("|");

    const next =
      await loadRecords();

    addApproximatePoints(next);

    const after =
      next
        .map(recordSignature)
        .join("|");

    allRecords = next;

    if (
      forceDraw ||
      before !== after
    ) {
      drawEverything();
    }
  } finally {
    refreshInProgress = false;
  }
}

/* -------------------------------------------------------
   RECORD NORMALIZATION
------------------------------------------------------- */

function normalizeRow(row, sourceIndex) {
  const x = Number(row["Map X"]);
  const y = Number(row["Map Y"]);

  const record = {
    sourceIndex,
    id: String(row.ID ?? "").trim(),
    date: String(row.Date ?? "").trim(),
    time: String(row.Time ?? "").trim(),
    pasture: normalizePastureId(
      String(row.Pasture ?? "").trim()
    ),
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
    notes: String(row.Notes ?? "").trim(),
    updatedAt: String(row["Updated At"] ?? "").trim(),
    approximate: false
  };

  record.dateTime =
    parseDateTime(record);

  return record;
}

function addApproximatePoints(records) {
  if (!CONFIG.SHOW_APPROXIMATE_OLD_POINTS) {
    return;
  }

  for (const record of records) {
    if (
      record.x !== null &&
      record.y !== null
    ) {
      continue;
    }

    const center =
      centroidForPasture(
        record.pasture
      );

    if (!center) continue;

    record.x = center[0];
    record.y = center[1];
    record.approximate = true;
  }
}

/* -------------------------------------------------------
   PASTURES
------------------------------------------------------- */

function normalizePastureId(id) {
  const value =
    String(id ?? "").trim().toLowerCase();

  if (
    value === "3a" ||
    value === "3b"
  ) {
    return "3";
  }

  return String(id ?? "").trim();
}

function pastureGroups() {
  const groups = new Map();

  for (const pasture of pastureData) {
    const id =
      normalizePastureId(pasture.id);

    if (!groups.has(id)) {
      groups.set(id, []);
    }

    groups.get(id).push(pasture);
  }

  return groups;
}

function pastureAt(x, y) {
  for (const pasture of pastureData) {
    if (
      pointInPolygon(
        [x, y],
        pasture.polygon
      )
    ) {
      return normalizePastureId(
        pasture.id
      );
    }
  }

  return "";
}

function centroidForPasture(id) {
  const normalized =
    normalizePastureId(id);

  const group =
    pastureGroups().get(
      normalized
    );

  if (!group || !group.length) {
    return null;
  }

  /*
    Use the first polygon's center,
    except for grouped Pasture 3 where
    averaging both polygon centers is better.
  */

  let totalX = 0;
  let totalY = 0;
  let count = 0;

  for (const pasture of group) {
    for (const point of pasture.polygon) {
      totalX += point[0];
      totalY += point[1];
      count++;
    }
  }

  if (!count) return null;

  return [
    totalX / count,
    totalY / count
  ];
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;

  let inside = false;

  for (
    let i = 0,
    j = polygon.length - 1;

    i < polygon.length;

    j = i++
  ) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];

    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      ((yi > y) !== (yj > y)) &&
      (
        x <
        ((xj - xi) *
          (y - yi)) /
          ((yj - yi) || 1e-9) +
          xi
      );

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/* -------------------------------------------------------
   DRAW PASTURES
------------------------------------------------------- */

function drawPastures() {
  pastureLayer.clearLayers();
  pastureLayers = [];

  for (const pasture of pastureData) {
    const normalizedId =
      normalizePastureId(
        pasture.id
      );

    const selected =
      selectedPastureFilter &&
      normalizePastureId(
        selectedPastureFilter
      ) === normalizedId;

    const layer =
      L.polygon(
        pasture.polygon.map(
          ([x, y]) => [y, x]
        ),
        {
          color: "#111",
          weight: selected
            ? 4
            : CONFIG.PASTURE_WEIGHT,
          opacity: selected
            ? 1
            : 0.8,
          fillColor:
            pasture.color,
          fillOpacity:
            selected
              ? 0.25
              : (
                selectedPastureFilter
                  ? 0.035
                  : CONFIG.PASTURE_FILL_OPACITY
              ),
          interactive: false
        }
      ).addTo(
        pastureLayer
      );

    layer.pastureId =
      normalizedId;

    pastureLayers.push(layer);
  }

  renderPastureLegend();
}

/* -------------------------------------------------------
   PASTURE DROPDOWN
------------------------------------------------------- */

function renderPastureLegend() {
  const list =
    $("pastureLegend");

  if (!pastureLegendOpen) {
    list.classList.add("collapsed");
    list.innerHTML =
      `<div class="pasture-collapsed-hint">
        Click Pastures to choose a pasture
      </div>`;
    return;
  }

  list.classList.remove("collapsed");

  const groups =
    pastureGroups();

  let html = `
    <button
      type="button"
      class="pasture-show-all"
      data-pasture-filter=""
      data-filter-type="all">
      Show All
    </button>
  `;

  for (const [id, group] of groups) {
    const color =
      group[0].color || "#777";

    const selected =
      normalizePastureId(
        selectedPastureFilter
      ) === id;

    html += `
      <div class="pasture-item ${
        selected
          ? "selected"
          : ""
      }">

        <div class="pasture-item-title">
          <span
            class="pasture-swatch"
            style="background:${esc(color)}">
          </span>

          <strong>
            Pasture ${esc(id)}
          </strong>
        </div>

        <div class="pasture-filter-buttons">

          <button
            type="button"
            data-pasture-filter="${esc(id)}"
            data-filter-type="pins">
            Pins
          </button>

          <button
            type="button"
            data-pasture-filter="${esc(id)}"
            data-filter-type="paths">
            Paths
          </button>

        </div>

      </div>
    `;
  }

  list.innerHTML = html;
}

/* -------------------------------------------------------
   PASTURE FILTER PATHS
------------------------------------------------------- */

function pastureGroupPolygons(id) {
  const normalized =
    normalizePastureId(id);

  return pastureData
    .filter(
      pasture =>
        normalizePastureId(
          pasture.id
        ) === normalized
    )
    .map(
      pasture =>
        pasture.polygon
    );
}

function segmentTouchesPasture(
  a,
  b,
  pastureId
) {
  const polygons =
    pastureGroupPolygons(
      pastureId
    );

  if (!polygons.length) {
    return false;
  }

  for (const polygon of polygons) {
    if (
      pointInPolygon(
        a,
        polygon
      ) ||
      pointInPolygon(
        b,
        polygon
      )
    ) {
      return true;
    }

    for (
      let i = 0;
      i < polygon.length;
      i++
    ) {
      const edgeA =
        polygon[i];

      const edgeB =
        polygon[
          (i + 1) %
          polygon.length
        ];

      if (
        segmentsIntersect(
          a,
          b,
          edgeA,
          edgeB
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function orientation(a, b, c) {
  const value =
    (b[1] - a[1]) *
      (c[0] - b[0]) -
    (b[0] - a[0]) *
      (c[1] - b[1]);

  if (Math.abs(value) < 1e-9) {
    return 0;
  }

  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    b[0] <=
      Math.max(a[0], c[0]) &&
    b[0] >=
      Math.min(a[0], c[0]) &&
    b[1] <=
      Math.max(a[1], c[1]) &&
    b[1] >=
      Math.min(a[1], c[1])
  );
}

function segmentsIntersect(
  p1,
  q1,
  p2,
  q2
) {
  const o1 =
    orientation(p1, q1, p2);

  const o2 =
    orientation(p1, q1, q2);

  const o3 =
    orientation(p2, q2, p1);

  const o4 =
    orientation(p2, q2, q1);

  if (
    o1 !== o2 &&
    o3 !== o4
  ) {
    return true;
  }

  if (
    o1 === 0 &&
    onSegment(p1, p2, q1)
  ) return true;

  if (
    o2 === 0 &&
    onSegment(p1, q2, q1)
  ) return true;

  if (
    o3 === 0 &&
    onSegment(p2, p1, q2)
  ) return true;

  if (
    o4 === 0 &&
    onSegment(p2, q1, q2)
  ) return true;

  return false;
}

/* -------------------------------------------------------
   DRAW PATHS
------------------------------------------------------- */

function drawPaths(records) {
  pathLayer.clearLayers();

  if (selectedPastPathDate) {
    const dayRecords = records.filter(
      record =>
        dateKeyFromRecord(record) === selectedPastPathDate &&
        record.x !== null &&
        record.y !== null
    );

    if (dayRecords.length >= 2) {
      L.polyline(
        dayRecords.map(record => [record.y, record.x]),
        {
          color: "#111",
          weight: 2.2,
          opacity: 0.92,
          lineJoin: "round",
          lineCap: "round"
        }
      ).addTo(pathLayer);
    }

    return;
  }

  if (records.length < 2) {
    return;
  }

  if (
    selectedFilterType === "paths" &&
    selectedPastureFilter
  ) {
    const id =
      normalizePastureId(
        selectedPastureFilter
      );

    for (
      let i = 1;
      i < records.length;
      i++
    ) {
      const previous =
        records[i - 1];

      const current =
        records[i];

      if (
        previous.x === null ||
        previous.y === null ||
        current.x === null ||
        current.y === null
      ) {
        continue;
      }

      if (
        segmentTouchesPasture(
          [previous.x, previous.y],
          [current.x, current.y],
          id
        )
      ) {
        L.polyline(
          [
            [
              previous.y,
              previous.x
            ],
            [
              current.y,
              current.x
            ]
          ],
          {
            color: "#111",
            weight:
              CONFIG.SEVEN_DAY_PATH_WEIGHT,
            opacity:
              CONFIG.SEVEN_DAY_PATH_OPACITY,
            lineJoin: "round",
            lineCap: "round"
          }
        ).addTo(
          pathLayer
        );
      }
    }

    return;
  }

  const valid =
    records.filter(
      record =>
        record.x !== null &&
        record.y !== null
    );

  const allPoints =
    valid.map(
      record =>
        [
          record.y,
          record.x
        ]
    );

  if (allPoints.length >= 2) {
    L.polyline(
      allPoints,
      {
        color: "#111",
        weight:
          CONFIG.FULL_PATH_WEIGHT,
        opacity:
          CONFIG.FULL_PATH_OPACITY,
        dashArray: "4 6",
        lineJoin: "round",
        lineCap: "round"
      }
    ).addTo(
      pathLayer
    );
  }

  const last =
    valid[valid.length - 1];

  if (!last || !last.dateTime) {
    return;
  }

  const cutoff =
    new Date(
      last.dateTime.getTime() -
      7 * 24 * 60 * 60 * 1000
    );

  const recent =
    valid.filter(
      record =>
        record.dateTime &&
        record.dateTime >= cutoff
    );

  if (recent.length >= 2) {
    L.polyline(
      recent.map(
        record =>
          [
            record.y,
            record.x
          ]
      ),
      {
        color: "#111",
        weight:
          CONFIG.SEVEN_DAY_PATH_WEIGHT,
        opacity:
          CONFIG.SEVEN_DAY_PATH_OPACITY,
        lineJoin: "round",
        lineCap: "round"
      }
    ).addTo(
      pathLayer
    );
  }
}

/* -------------------------------------------------------
   DRAW MARKERS
------------------------------------------------------- */

function sortedRecords() {
  return allRecords
    .filter(
      record =>
        record.dateTime
    )
    .sort(
      (a, b) =>
        a.dateTime - b.dateTime
    );
}

function isLastRecord(record) {
  const records =
    sortedRecords();

  return (
    records.length > 0 &&
    records[records.length - 1] ===
      record
  );
}

function drawMarkers() {
  markerLayer.clearLayers();

  let records =
    sortedRecords();

  if (selectedPastPathDate) {
    records = records.filter(
      record =>
        dateKeyFromRecord(record) === selectedPastPathDate
    );
  }

  if (
    selectedFilterType === "pins" &&
    selectedPastureFilter
  ) {
    records =
      records.filter(
        record =>
          normalizePastureId(
            record.pasture ||
            pastureAt(
              record.x,
              record.y
            )
          ) ===
          normalizePastureId(
            selectedPastureFilter
          )
      );
  }

  records.forEach(
    (record, index) => {
      if (
        record.x === null ||
        record.y === null
      ) {
        return;
      }

      const marker =
        L.marker(
          [
            record.y,
            record.x
          ],
          {
            icon:
              makeFlerdIcon(
                record.sourceIndex,
                isLastRecord(record),
                record.approximate
              ),
            zIndexOffset:
              isLastRecord(record)
                ? 1000
                : index
          }
        ).addTo(
          markerLayer
        );

      marker.recordId =
        record.id;

      marker.bindPopup(
        recordPopup(record)
      );

      marker.on(
        "click",
        () => {
          if (
            editMode &&
            record.id
          ) {
            startEditingRecord(
              record
            );
          }
        }
      );
    }
  );
}

function makeFlerdIcon(
  index,
  isLast,
  approximate = false
) {
  const kind =
    index % 2 === 0
      ? "cow"
      : "sheep";

  const size =
    isLast ? 42 : 32;

  const iconUrl =
    kind === "cow"
      ? CONFIG.COW_ICON
      : CONFIG.SHEEP_ICON;

  const cls =
    [
      "flerd-marker",
      isLast
        ? "last-seen"
        : "",
      approximate
        ? "approximate-marker"
        : ""
    ]
      .filter(Boolean)
      .join(" ");

  return L.divIcon({
    className: "",
    html:
      `<div class="${cls}" title="${kind}">
        <img src="${esc(iconUrl)}" alt="${kind}">
      </div>`,
    iconSize: [size, size],
    iconAnchor: [
      size / 2,
      size / 2
    ],
    popupAnchor: [
      0,
      -size / 2
    ]
  });
}

function recordPopup(record) {
  const approximate =
    record.approximate
      ? `<div class="popup-note">
          <strong>Approximate:</strong>
          This older row had no Map X/Y,
          so it is shown near the pasture center.
        </div>`
      : "";

  const edit =
    record.id
      ? `<button
          class="popup-edit-btn"
          data-edit-id="${esc(record.id)}">
          Move / edit pin
        </button>`
      : `<div class="popup-note">
          This record does not have a stable ID yet.
        </div>`;

  return `
    <div class="popup-content">
      <strong>
        ${esc(formatDate(record.dateTime))}
      </strong>
      <br>
      ${esc(
        formatTime(
          record.dateTime,
          record.time
        )
      )}
      · Pasture
      ${esc(
        record.pasture ||
        pastureAt(
          record.x,
          record.y
        ) ||
        "—"
      )}

      ${
        record.notes
          ? `<div class="popup-notes">
              ${esc(record.notes)}
             </div>`
          : ""
      }

      ${approximate}
      ${edit}
    </div>
  `;
}

/* -------------------------------------------------------
   EVERYTHING
------------------------------------------------------- */

function drawEverything() {
  drawPastures();

  const records =
    sortedRecords();

  drawPaths(records);
  drawMarkers();
  updateStatusText(records);
}

/* -------------------------------------------------------
   STATUS
------------------------------------------------------- */

function updateStatusText(records) {
  if (selectedPastPathDate) {
    const dayRecords = records.filter(
      record =>
        dateKeyFromRecord(record) === selectedPastPathDate
    );

    if (!dayRecords.length) {
      $("lastSeenText").textContent =
        "No location found for the selected date.";
      $("sevenDayText").textContent =
        "Past Path Lookup is active.";
      return;
    }

    const first = dayRecords[0];
    const last = dayRecords[dayRecords.length - 1];

    $("lastSeenText").innerHTML =
      `<strong>Past Path Lookup:</strong> ${esc(
        formatDate(last.dateTime)
      )} · ${dayRecords.length} location${
        dayRecords.length === 1 ? "" : "s"
      }`;

    $("sevenDayText").textContent =
      dayRecords.length === 1
        ? `One documented location at ${formatTime(last.dateTime, last.time)}.`
        : `Path from ${formatTime(first.dateTime, first.time)} to ${formatTime(last.dateTime, last.time)}.`;

    return;
  }

  if (!records.length) {
    $("lastSeenText").textContent =
      "No location yet";

    $("sevenDayText").textContent =
      "No recent locations yet";

    return;
  }

  const last =
    records[records.length - 1];

  $("lastSeenText").innerHTML =
    `${esc(formatDate(last.dateTime))}
     · ${esc(formatTime(last.dateTime, last.time))}
     · Pasture
     ${esc(
       last.pasture ||
       pastureAt(
         last.x,
         last.y
       ) ||
       "—"
     )}` +
    (
      last.approximate
        ? " (approx.)"
        : ""
    );

  const cutoff =
    new Date(
      last.dateTime.getTime() -
      7 * 24 * 60 * 60 * 1000
    );

  const recent =
    records.filter(
      record =>
        record.dateTime &&
        record.dateTime >= cutoff
    );

  $("sevenDayText").textContent =
    `${recent.length} documented location${
      recent.length === 1
        ? ""
        : "s"
    } in the last 7 days`;
}


/* -------------------------------------------------------
   PAST PATH LOOKUP
------------------------------------------------------- */

function parseLookupDate(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyFromRecord(record) {
  if (!record.dateTime) return null;

  return `${record.dateTime.getFullYear()}-` +
    `${String(record.dateTime.getMonth() + 1).padStart(2, "0")}-` +
    `${String(record.dateTime.getDate()).padStart(2, "0")}`;
}

function showPastPathLookup() {
  const input = $("pastPathDate");
  const status = $("pastPathStatus");
  const key = parseLookupDate(input.value);

  if (!key) {
    selectedPastPathDate = null;
    status.textContent = "Enter a valid date as MM/DD/YYYY.";
    drawEverything();
    return;
  }

  const matching = sortedRecords().filter(
    record =>
      dateKeyFromRecord(record) === key &&
      record.x !== null &&
      record.y !== null
  );

  if (!matching.length) {
    selectedPastPathDate = null;
    status.textContent =
      `No Flerd locations were found for ${input.value}.`;
    drawEverything();
    return;
  }

  selectedPastPathDate = key;

  const labelDate = new Date(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10))
  );

  status.innerHTML =
    `<span class="past-path-active">Viewing ${esc(
      labelDate.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric"
      })
    )}</span> · ${matching.length} location${matching.length === 1 ? "" : "s"}`;

  drawEverything();
  showToast(`Showing Flerd movement for ${input.value}.`);
}

function clearPastPathLookup() {
  selectedPastPathDate = null;
  $("pastPathDate").value = "";
  $("pastPathStatus").textContent = "";
  drawEverything();
  showToast("Returned to the normal map.");
}

/* -------------------------------------------------------
   PASTURE EDITING
------------------------------------------------------- */

function setPastureEditMode(active) {
  pastureEditMode = active;

  if (active) {
    pastureEditBackup = deepCopyPastures(pastureData);
    setRecordingMode(false);
    setEditMode(false);

    $("editPasturesBtn")
      .classList.add("active");

    $("editPasturesBtn").textContent =
      "✓ Editing pastures";

    $("savePasturesBtn")
      .classList.remove("hidden");

    $("cancelPasturesBtn")
      .classList.remove("hidden");

    showToast(
      "Drag the pasture boundary points."
    );

    createPastureVertexMarkers();
  } else {
    $("editPasturesBtn")
      .classList.remove("active");

    $("editPasturesBtn").textContent =
      "Edit pasture boundaries";

    $("savePasturesBtn")
      .classList.add("hidden");

    $("cancelPasturesBtn")
      .classList.add("hidden");

    clearPastureVertexMarkers();
  }
}

function createPastureVertexMarkers() {
  clearPastureVertexMarkers();

  pastureData.forEach(
    (pasture, pastureIndex) => {
      pasture.polygon.forEach(
        (point, pointIndex) => {
          const marker =
            L.marker(
              [
                point[1],
                point[0]
              ],
              {
                draggable: true,
                icon: L.divIcon({
                  className:
                    "pasture-vertex-icon",
                  html:
                    `<div></div>`,
                  iconSize:
                    [16, 16],
                  iconAnchor:
                    [8, 8]
                }),
                zIndexOffset: 3000
              }
            ).addTo(
              editingPastureLayer
            );

          marker.on(
            "drag",
            event => {
              const p =
                event.target
                  .getLatLng();

              pastureData[
                pastureIndex
              ].polygon[
                pointIndex
              ] = [
                Math.round(p.lng),
                Math.round(p.lat)
              ];

              drawPastureEditOverlay();
            }
          );

          pastureVertexMarkers.push(
            marker
          );
        }
      );
    }
  );

  drawPastureEditOverlay();
}

function drawPastureEditOverlay() {
  editingPastureLayer
    .eachLayer(
      layer => {
        if (
          !pastureVertexMarkers.includes(
            layer
          )
        ) {
          editingPastureLayer
            .removeLayer(layer);
        }
      }
    );

  pastureData.forEach(
    pasture => {
      L.polygon(
        pasture.polygon.map(
          ([x, y]) => [y, x]
        ),
        {
          color: "#111",
          weight: 3,
          dashArray: "6 4",
          fillOpacity: 0,
          interactive: false
        }
      ).addTo(
        editingPastureLayer
      );
    }
  );
}

function clearPastureVertexMarkers() {
  editingPastureLayer.clearLayers();
  pastureVertexMarkers = [];
}

function savePastureBoundaries() {
  localStorage.setItem(
    "flerdPastures",
    JSON.stringify(
      pastureData
    )
  );

  pastureEditBackup = null;

  drawPastures();

  setPastureEditMode(false);

  showToast(
    "Pasture boundaries saved on this device."
  );
}

function restorePastures() {
  if (pastureEditBackup) {
    pastureData =
      deepCopyPastures(
        pastureEditBackup
      );
  } else {
    pastureData =
      deepCopyPastures(
        window.PASTURES || []
      );
  }

  pastureEditBackup = null;
}

/* -------------------------------------------------------
   HELPERS
------------------------------------------------------- */

function parseDateTime(row) {
  const dateRaw =
    String(
      row.date ??
      row.Date ??
      ""
    ).trim();

  const timeRaw =
    String(
      row.time ??
      row.Time ??
      ""
    ).trim();

  if (!dateRaw) return null;

  const parts =
    dateRaw.split(
      /[\/-]/
    );

  if (parts.length < 2) {
    return null;
  }

  const month =
    Number(parts[0]);

  const day =
    Number(parts[1]);

  let year =
    Number(parts[2]) ||
    CONFIG.DATA_YEAR;

  if (year < 100) {
    year += 2000;
  }

  let hour = 12;
  let minute = 0;

  const t =
    timeRaw
      .toUpperCase()
      .trim();

  const match =
    t.match(
      /(\d{1,2})(?::(\d{2}))?/
    );

  if (match) {
    hour =
      Number(match[1]);

    minute =
      Number(match[2] || 0);

    if (
      t.includes("PM") &&
      hour < 12
    ) {
      hour += 12;
    }

    if (
      t.includes("AM") &&
      hour === 12
    ) {
      hour = 0;
    }
  }

  const dt =
    new Date(
      year,
      month - 1,
      day,
      hour,
      minute
    );

  return Number.isNaN(
    dt.getTime()
  )
    ? null
    : dt;
}

function formatDate(dt) {
  return dt
    ? dt.toLocaleDateString(
        undefined,
        {
          month: "short",
          day: "numeric",
          year: "numeric"
        }
      )
    : "Unknown date";
}

function formatTime(dt, raw) {
  return dt
    ? dt.toLocaleTimeString(
        undefined,
        {
          hour: "numeric",
          minute: "2-digit"
        }
      )
    : (
      raw ||
      "Unknown time"
    );
}

function toDateInputValue(record) {
  if (!record.dateTime) {
    return "";
  }

  const y =
    record.dateTime
      .getFullYear();

  const m =
    String(
      record.dateTime
        .getMonth() + 1
    ).padStart(2, "0");

  const d =
    String(
      record.dateTime
        .getDate()
    ).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function toTimeInputValue(record) {
  if (!record.dateTime) {
    return "";
  }

  return (
    String(
      record.dateTime
        .getHours()
    ).padStart(2, "0") +
    ":" +
    String(
      record.dateTime
        .getMinutes()
    ).padStart(2, "0")
  );
}

function formatDateForSheet(value) {
  if (!value) return "";

  const [y, m, d] =
    value.split("-")
      .map(Number);

  return `${m}/${d}/${y}`;
}

function formatTimeForSheet(value) {
  if (!value) return "";

  const [h, m] =
    value.split(":")
      .map(Number);

  const suffix =
    h >= 12
      ? "PM"
      : "AM";

  const hour =
    h % 12 || 12;

  return (
    `${hour}:` +
    `${String(m).padStart(2, "0")} ` +
    suffix
  );
}

function loadPasturesFromStorage() {
  try {
    const saved =
      localStorage.getItem(
        "flerdPastures"
      );

    if (!saved) {
      return null;
    }

    const parsed =
      JSON.parse(saved);

    return Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_) {
    return null;
  }
}

function showToast(message) {
  const el =
    $("toast");

  el.textContent =
    message;

  el.classList.add(
    "show"
  );

  clearTimeout(
    toastTimer
  );

  toastTimer =
    setTimeout(
      () => {
        el.classList.remove(
          "show"
        );
      },
      3200
    );
}

/* -------------------------------------------------------
   BEGIN
------------------------------------------------------- */

document.addEventListener(
  "DOMContentLoaded",
  start
);
