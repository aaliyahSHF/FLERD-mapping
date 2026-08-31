/*
  ============================================================
  FLERD PASTURE TRACKER
  ============================================================

  Leaflet + GitHub Pages + Google Sheets/Apps Script.

  The map uses pixel coordinates from assets/SHF map.png:
    Map X = image column (0 -> 724)
    Map Y = image row    (0 -> 582)
  
   Map coordinates:

      X = image column
      Y = image row

   Image:

      724 x 582

  Google Sheets is the source of truth for:

      1. Location history
      2. Pasture boundaries
      
/*



/* ============================================================
   CONFIGURATION
============================================================ */

const CONFIG = {

  MAP_IMAGE:
    "SHF map.png",

  MAP_WIDTH:
    724,

  MAP_HEIGHT:
    582,

  APPS_SCRIPT_URL:
    "",

  COW_ICON:
    "cow.svg",

  SHEEP_ICON:
    "sheep.svg",

  CSV_FILE:
    "flerd-log.csv",

  SYNC_INTERVAL:
    15000

};


/* ============================================================
   GLOBAL STATE
============================================================ */

let map;

let markerLayer;
let pathLayer;
let pastureLayer;
let boundaryEditLayer;

let allRecords = [];

let pastureData = [];

let pastureLocked = true;

let recordingMode = false;

let editMode = false;

let boundaryEditMode = false;

let selectedPoint = null;

let editingRecord = null;

let targetMarker = null;

let lastLoggedRecord = null;

let selectedPastureFilter = null;

let pastureLegendOpen = true;

let selectedPastPathStart = null;

let selectedPastPathEnd = null;

let selectedPastPathScope = "all";

let syncTimer = null;

let toastTimer = null;


/* ============================================================
   HELPERS
============================================================ */

function $(id) {

  return document.getElementById(id);

}


function esc(value) {

  return String(
    value ?? ""
  )
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


function deepCopy(value) {

  return JSON.parse(
    JSON.stringify(value)
  );

}


function normalizePastureId(id) {

  const value =
    String(id ?? "")
      .trim()
      .toLowerCase();


  if (
    value === "3a" ||
    value === "3b"
  ) {

    return "3";

  }


  return String(id ?? "").trim();

}


/* ============================================================
   START
============================================================ */

async function start() {

  initializeMap();

  wireUI();

  pastureData =
    deepCopy(
      window.DEFAULT_PASTURES || []
    );


  await loadPastures();

  drawPastures();

  populatePastureSelectors();

  await refreshData(true);

  syncTimer =
    setInterval(
      () => refreshData(false),
      CONFIG.SYNC_INTERVAL
    );

}


/* ============================================================
   MAP
============================================================ */

function initializeMap() {

  map =
    L.map(
      "map",
      {
        crs:
          L.CRS.Simple,

        minZoom:
          -2,

        maxZoom:
          4,

        zoomSnap:
          0.25,

        attributionControl:
          false
      }
    );


  markerLayer =
    L.layerGroup()
      .addTo(map);


  pathLayer =
    L.layerGroup()
      .addTo(map);


  pastureLayer =
    L.layerGroup()
      .addTo(map);


  boundaryEditLayer =
    L.layerGroup()
      .addTo(map);


  const bounds = [

    [0, 0],

    [
      CONFIG.MAP_HEIGHT,
      CONFIG.MAP_WIDTH
    ]

  ];


  L.imageOverlay(
    CONFIG.MAP_IMAGE,
    bounds,
    {
      interactive:
        false
    }
  ).addTo(map);


  map.fitBounds(
    bounds
  );


  map.on(
    "click",
    event => {

      if (
        recordingMode
      ) {

        choosePoint(
          event.latlng
        );

      }

    }
  );

}


/* ============================================================
   UI
============================================================ */

function wireUI() {

  $("sidebarToggle")
    .addEventListener(
      "click",
      toggleSidebar
    );


  $("sidebarClose")
    .addEventListener(
      "click",
      closeSidebar
    );


  $("recordBtn")
    .addEventListener(
      "click",
      () => {

        setRecordingMode(
          !recordingMode
        );

      }
    );


  $("editBtn")
    .addEventListener(
      "click",
      () => {

        setEditMode(
          !editMode
        );

      }
    );


  $("closeRecord")
    .addEventListener(
      "click",
      closeRecordPanel
    );


  $("cancelRecord")
    .addEventListener(
      "click",
      closeRecordPanel
    );


  $("saveRecord")
    .addEventListener(
      "click",
      saveLocation
    );


  $("closeEdit")
    .addEventListener(
      "click",
      closeEditPanel
    );


  $("cancelEditBtn")
    .addEventListener(
      "click",
      closeEditPanel
    );


  $("saveEdit")
    .addEventListener(
      "click",
      saveEditedRecord
    );


  $("adminBtn")
    .addEventListener(
      "click",
      openAdmin
    );


  $("closeAdmin")
    .addEventListener(
      "click",
      closeAdmin
    );


  $("adminLoginBtn")
    .addEventListener(
      "click",
      adminLogin
    );


  $("editBoundariesBtn")
    .addEventListener(
      "click",
      beginBoundaryEditing
    );


  $("saveBoundariesBtn")
    .addEventListener(
      "click",
      saveBoundaryChanges
    );


  $("cancelBoundaryEditBtn")
    .addEventListener(
      "click",
      cancelBoundaryEditing
    );


  $("pastureToggle")
    .addEventListener(
      "click",
      () => {

        pastureLegendOpen =
          !pastureLegendOpen;

        renderPastureLegend();

      }
    );


  $("pastPathShow")
    .addEventListener(
      "click",
      showPastPath
    );


  $("pastPathClear")
    .addEventListener(
      "click",
      clearPastPath
    );


  $("loggedEditBtn")
    .addEventListener(
      "click",
      editLoggedRecord
    );


  document
    .addEventListener(
      "click",
      event => {

        const button =
          event.target.closest(
            "[data-edit-id]"
          );


        if (!button) {
          return;
        }


        const record =
          allRecords.find(
            item =>
              item.id ===
              button.dataset.editId
          );


        if (record) {

          startEditingRecord(
            record
          );

        }

      }
    );

}


/* ============================================================
   SIDEBAR
============================================================ */

function toggleSidebar() {

  document.body
    .classList.toggle(
      "sidebar-collapsed"
    );

}


function closeSidebar() {

  document.body
    .classList.add(
      "sidebar-collapsed"
    );

}


/* ============================================================
   PASTURES FROM GOOGLE SHEETS
============================================================ */

async function loadPastures() {

  if (
    !CONFIG.APPS_SCRIPT_URL
  ) {

    pastureLocked =
      true;

    return;

  }


  try {

    const result =
      await loadAppsScript(
        "getPastures"
      );


    if (
      result &&
      result.exists &&
      Array.isArray(
        result.pastures
      ) &&
      result.pastures.length
    ) {

      pastureData =
        result.pastures;

      pastureLocked =
        Boolean(
          result.locked
        );

    }

  } catch (error) {

    console.warn(
      "Pasture sync failed",
      error
    );

  }

}


/* ============================================================
   PASTURE DRAWING
============================================================ */

function pastureGroups() {

  const groups =
    new Map();


  pastureData.forEach(
    pasture => {

      const groupId =
        pasture.group ||
        pasture.id;


      const id =
        String(groupId);


      if (
        !groups.has(id)
      ) {

        groups.set(
          id,
          []
        );

      }


      groups
        .get(id)
        .push(pasture);

    }
  );


  return groups;

}


function drawPastures() {

  pastureLayer.clearLayers();

  boundaryEditLayer.clearLayers();


  pastureData.forEach(
    pasture => {

      const groupId =
        pasture.group ||
        pasture.id;


      const selected =
        selectedPastureFilter &&
        normalizePastureId(
          selectedPastureFilter
        ) ===
        normalizePastureId(
          groupId
        );


      const polygon =
        L.polygon(
          pasture.polygon.map(
            ([x, y]) =>
              [y, x]
          ),
          {

            color:
              "#111",

            weight:
              selected
                ? 4
                : 2,

            opacity:
              selected
                ? 1
                : 0.8,

            fillColor:
              pasture.color,

            fillOpacity:
              selected
                ? 0.3
                : 0.12,

            interactive:
              true

          }
        );


      /*
        Hovering over the pasture displays
        its name.
      */

      polygon.bindTooltip(
        pasture.name,
        {
          sticky:
            true,

          direction:
            "center",

          className:
            "pasture-tooltip"
        }
      );


      polygon.on(
        "mouseover",
        () => {

          polygon.setStyle({
            weight: 4,
            fillOpacity: 0.28
          });

        }
      );


      polygon.on(
        "mouseout",
        () => {

          polygon.setStyle({

            weight:
              selected
                ? 4
                : 2,

            fillOpacity:
              selected
                ? 0.3
                : 0.12

          });

        }
      );


      polygon.on(
        "click",
        event => {

          L.DomEvent.stopPropagation(
            event
          );


          selectedPastureFilter =
            normalizePastureId(
              groupId
            );


          renderPastureLegend();

          drawEverything();

        }
      );


      polygon.addTo(
        pastureLayer
      );

    }
  );


  renderPastureLegend();

}


/* ============================================================
   PASTURE LEGEND
============================================================ */

function renderPastureLegend() {

  const list =
    $("pastureLegend");


  const chevron =
    $("pastureChevron");


  if (
    !pastureLegendOpen
  ) {

    list.classList.add(
      "collapsed"
    );

    chevron.textContent =
      "▶";

    return;

  }


  list.classList.remove(
    "collapsed"
  );

  chevron.textContent =
    "▼";


  const groups =
    pastureGroups();


  let html = "";


  html += `
    <button
      type="button"
      class="pasture-option ${
        !selectedPastureFilter
          ? "selected"
          : ""
      }"
      data-pasture-filter="all">
      <span class="pasture-color all-color"></span>
      Total property
    </button>
  `;


  groups.forEach(
    (group, id) => {

      const color =
        group[0].color ||
        "#777";


      const selected =
        selectedPastureFilter &&
        normalizePastureId(
          selectedPastureFilter
        ) ===
        normalizePastureId(id);


      html += `
        <button
          type="button"
          class="pasture-option ${
            selected
              ? "selected"
              : ""
          }"
          data-pasture-filter="${esc(id)}">

          <span
            class="pasture-color"
            style="background:${esc(color)}">
          </span>

          ${esc(
            group[0].group
              ? `Pasture ${id}`
              : group[0].name
          )}

        </button>
      `;

    }
  );


  list.innerHTML =
    html;


  list
    .querySelectorAll(
      "[data-pasture-filter]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const value =
              button.dataset
                .pastureFilter;


            if (
              value === "all"
            ) {

              selectedPastureFilter =
                null;

            } else {

              selectedPastureFilter =
                value;

            }


            drawEverything();

          }
        );

      }
    );

}


/* ============================================================
   RECORDING A NEW LOCATION
============================================================ */

function setRecordingMode(
  active
) {

  recordingMode =
    active;


  if (active) {

    setEditMode(
      false
    );


    $("recordBtn")
      .classList.add(
        "recording"
      );


    $("recordBtn")
      .textContent =
      "Click map to place pin";


    showToast(
      "Click where the Flerd is located."
    );


  } else {

    $("recordBtn")
      .classList.remove(
        "recording"
      );


    $("recordBtn")
      .textContent =
      "＋ Record location";


    clearTargetMarker();

  }

}


/* ============================================================
   CHOOSE MAP LOCATION
============================================================ */

function choosePoint(
  latlng
) {

  const x =
    Math.round(
      latlng.lng
    );


  const y =
    Math.round(
      latlng.lat
    );


  selectedPoint = {

    x: x,

    y: y,

    pasture:
      pastureAt(
        x,
        y
      )

  };


  clearTargetMarker();


  targetMarker =
    L.circleMarker(
      [y, x],
      {

        radius:
          8,

        color:
          "#111",

        fillColor:
          "#fff",

        fillOpacity:
          1,

        weight:
          3

      }
    )
      .addTo(map);


  $("selectedLocation")
    .classList.remove(
      "hidden"
    );


  $("selectedLocation")
    .innerHTML = `

      <strong>Location selected</strong>

      <br>

      X:
      ${x}

      ·

      Y:
      ${y}

      <br>

      Pasture:
      ${
        esc(
          selectedPoint.pasture ||
          "Outside of set pasture parameters"
        )
      }

    `;


  $("recordPanel")
    .classList.remove(
      "hidden"
    );


  $("saveRecord")
    .disabled =
    false;


  $("tapHint")
    .textContent =
    "Add an optional note, then save the location.";


  $("notes")
    .focus();

}


/* ============================================================
   SAVE LOCATION
============================================================ */

async function saveLocation() {

  if (
    !selectedPoint
  ) {
    return;
  }


  const now =
    new Date();


  const row = {

    action:
      "saveLocation",

    Date:
      formatDateForSheet(
        now
      ),

    Time:
      formatTimeForSheet(
        now
      ),

    Pasture:
      selectedPoint.pasture ||
      "",

    "Map X":
      selectedPoint.x,

    "Map Y":
      selectedPoint.y,

    Notes:
      $("notes")
        .value
        .trim(),

    ID:
      ""

  };


  $("saveRecord")
    .disabled =
    true;


  $("saveRecord")
    .textContent =
    "Saving…";


  try {

    const response =
      await submitToAppsScript(
        row
      );


    /*
      Immediately constructs the local record so the
      pin appears without waiting for the next poll.
    */

    const localRecord =
      normalizeRow(
        {
          ...row,
          ID:
            response.id ||
            `local-${Date.now()}`,
          "Updated At":
            new Date()
              .toISOString()
        },
        allRecords.length
      );


    allRecords.push(
      localRecord
    );


    closeRecordPanel();


    drawEverything();


    showLoggedStar(
      localRecord
    );


    /*
      Re-reads Google Sheets shortly after saving.
    */

    setTimeout(
      () => refreshData(true),
      1000
    );


  } catch (error) {

    console.error(
      error
    );


    showToast(
      "The location could not be saved."
    );

  } finally {

    $("saveRecord")
      .disabled =
      false;

    $("saveRecord")
      .textContent =
      "Save location";

  }

}


/* ============================================================
   LOGGED STAR
============================================================ */

function showLoggedStar(
  record
) {

  lastLoggedRecord =
    record;


  const star =
    $("loggedStar");


  $("loggedSummary")
    .innerHTML = `

      <strong>
        ${esc(
          formatDate(
            record.dateTime
          )
        )}
      </strong>

      <br>

      ${esc(
        formatTime(
          record.dateTime,
          record.time
        )
      )}

      <br>

      ${
        record.pasture
          ? `Pasture ${esc(record.pasture)}`
          : "Outside pasture"
      }

      ${
        record.notes
          ? `<br><span>${esc(record.notes)}</span>`
          : ""
      }

    `;


  star.classList.remove(
    "hidden"
  );


  clearTimeout(
    star._timer
  );


  star._timer =
    setTimeout(
      () => {

        star.classList.add(
          "hidden"
        );

      },
      5000
    );

}


function editLoggedRecord() {

  if (
    !lastLoggedRecord
  ) {
    return;
  }


  $("loggedStar")
    .classList.add(
      "hidden"
    );


  startEditingRecord(
    lastLoggedRecord
  );

}


/* ============================================================
   RECORD PANEL
============================================================ */

function closeRecordPanel() {

  $("recordPanel")
    .classList.add(
      "hidden"
    );


  $("notes")
    .value =
    "";


  selectedPoint =
    null;


  clearTargetMarker();


  setRecordingMode(
    false
  );

}


function clearTargetMarker() {

  if (
    targetMarker
  ) {

    map.removeLayer(
      targetMarker
    );

    targetMarker =
      null;

  }

}


/* ============================================================
   EDIT MODE
============================================================ */

function setEditMode(
  active
) {

  editMode =
    active;


  $("editBtn")
    .classList.toggle(
      "active",
      active
    );


  $("editBtn")
    .textContent =
    active
      ? "✓ Editing pins"
      : "✎ Edit pins";


  if (active) {

    setRecordingMode(
      false
    );


    showToast(
      "Click an existing pin to edit it."
    );

  }


  drawMarkers();

}


/* ============================================================
   START EDITING RECORD
============================================================ */

function startEditingRecord(
  record
) {

  if (
    !record.id
  ) {

    showToast(
      "This location doesn't have an ID."
    );

    return;

  }


  editingRecord =
    record;


  selectedPoint = {

    x:
      record.x,

    y:
      record.y,

    pasture:
      record.pasture

  };


  clearTargetMarker();


  targetMarker =
    L.marker(
      [
        record.y,
        record.x
      ],
      {
        draggable:
          true,

        icon:
          makeFlerdIcon(
            record
          ),

        zIndexOffset:
          2000
      }
    )
      .addTo(map);


  targetMarker.on(
    "drag",
    () => {

      const point =
        targetMarker
          .getLatLng();


      selectedPoint = {

        x:
          Math.round(
            point.lng
          ),

        y:
          Math.round(
            point.lat
          ),

        pasture:
          pastureAt(
            Math.round(
              point.lng
            ),
            Math.round(
              point.lat
            )
          )

      };


      updateEditLocationText();

    }
  );


  $("editDate")
    .value =
    toDateInputValue(
      record
    );


  $("editTime")
    .value =
    toTimeInputValue(
      record
    );


  $("editNotes")
    .value =
    record.notes ||
    "";


  updateEditLocationText();


  $("editPanel")
    .classList.remove(
      "hidden"
    );

}


function updateEditLocationText() {

  $("editSelectedLocation")
    .innerHTML = `

      <strong>Location</strong>

      <br>

      X:
      ${selectedPoint.x}

      ·

      Y:
      ${selectedPoint.y}

      <br>

      Pasture:
      ${
        esc(
          selectedPoint.pasture ||
          "Outside pasture"
        )
      }

    `;

}


function closeEditPanel() {

  $("editPanel")
    .classList.add(
      "hidden"
    );


  editingRecord =
    null;


  clearTargetMarker();

}


/* ============================================================
   SAVE EDITED RECORD
============================================================ */

async function saveEditedRecord() {

  if (
    !editingRecord ||
    !selectedPoint
  ) {
    return;
  }


  const row = {

    action:
      "saveLocation",

    ID:
      editingRecord.id,

    Date:
      formatDateForSheet(
        fromDateInput(
          $("editDate").value
        )
      ),

    Time:
      formatTimeInputForSheet(
        $("editTime").value
      ),

    Pasture:
      selectedPoint.pasture ||
      "",

    "Map X":
      selectedPoint.x,

    "Map Y":
      selectedPoint.y,

    Notes:
      $("editNotes")
        .value
        .trim()

  };


  $("saveEdit")
    .disabled =
    true;


  $("saveEdit")
    .textContent =
    "Saving…";


  try {

    const response =
      await submitToAppsScript(
        row
      );


    Object.assign(
      editingRecord,
      normalizeRow(
        {
          ...row,
          ID:
            response.id ||
            editingRecord.id,
          "Updated At":
            new Date()
              .toISOString()
        },
        editingRecord.sourceIndex
      )
    );


    closeEditPanel();

    drawEverything();


    showToast(
      "Location updated :) "
    );


    setTimeout(
      () => refreshData(true),
      800
    );


  } catch (error) {

    console.error(
      error
    );


    showToast(
      "Could not update the location...try again"
    );

  } finally {

    $("saveEdit")
      .disabled =
      false;

    $("saveEdit")
      .textContent =
      "Save changes";

  }

}


/* ============================================================
   GOOGLE APPS SCRIPT COMMUNICATION
============================================================ */

function submitToAppsScript(
  payload
) {

  if (
    !CONFIG.APPS_SCRIPT_URL
  ) {

    /*
      Development fallback. (4 sync)

    */

    return Promise.resolve({
      ok: true,
      id:
        payload.ID ||
        `local-${Date.now()}`
    });

  }


  return new Promise(
    (resolve, reject) => {

      const frameName =
        "flerdAppsScriptFrame";


      let frame =
        document.getElementById(
          frameName
        );


      if (!frame) {

        frame =
          document.createElement(
            "iframe"
          );

        frame.id =
          frameName;

        frame.name =
          frameName;

        frame.hidden =
          true;

        document.body.appendChild(
          frame
        );

      }


      const form =
        document.createElement(
          "form"
        );


      form.method =
        "POST";

      form.action =
        CONFIG.APPS_SCRIPT_URL;

      form.target =
        frameName;

      form.hidden =
        true;


      const input =
        document.createElement(
          "input"
        );


      input.name =
        "payload";

      input.value =
        JSON.stringify(
          payload
        );


      form.appendChild(
        input
      );


      document.body.appendChild(
        form
      );


      form.submit();

      form.remove();


      /*
        Apps Script POST requests do not expose their response
        cross-origin to the page, so the app verifies the write
        by polling Google Sheets afterward.
      */

      setTimeout(
        () => {

          resolve({
            ok: true,
            id:
              payload.ID ||
              null
          });

        },
        700
      );

    }
  );

}


function loadAppsScript(
  action
) {

  return new Promise(
    (resolve, reject) => {

      if (
        !CONFIG.APPS_SCRIPT_URL
      ) {

        reject(
          new Error(
            "Error! (Apps Script) "
          )
          /* Apps Script URL not configured. 
          */
        );
      

        return;

      }


      const callback =
        `flerdCallback_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`;


      const script =
        document.createElement(
          "script"
        );


      function cleanup() {

        delete window[
          callback
        ];

        script.remove();

      }


      window[
        callback
      ] = payload => {

        cleanup();

        resolve(
          payload
        );

      };


      script.onerror =
        () => {

          cleanup();

          reject(
            new Error(
              "Error! (Google sheets) "
            )
            /* Google Sheets request failed
            */
          );

        };


      script.src =
        `${CONFIG.APPS_SCRIPT_URL}` +
        `?action=${encodeURIComponent(action)}` +
        `&callback=${encodeURIComponent(callback)}` +
        `&t=${Date.now()}`;


      document.body.appendChild(
        script
      );

    }
  );

}


/* ============================================================
   DATA REFRESH
============================================================ */

async function refreshData(
  force
) {

  try {

    let googleRecords =
      [];


    if (
      CONFIG.APPS_SCRIPT_URL
    ) {

      googleRecords =
        await loadAppsScript(
          "getLocations"
        );

    }


    /*
      Only use the CSV when Google Sheets is not configured.

      Once Sheets is connected, Sheets is the source of truth.
    */

    if (
      !CONFIG.APPS_SCRIPT_URL
    ) {

      googleRecords =
        await loadCsv();

    }


    const normalized =
      googleRecords.map(
        (row, index) =>
          normalizeRow(
            row,
            index
          )
      );


    const changed =
      recordSignature(
        normalized
      ) !==
      recordSignature(
        allRecords
      );


    allRecords =
      normalized;


    updateSyncStatus(
      true
    );


    if (
      force ||
      changed
    ) {

      drawEverything();

    }

  } catch (error) {

    console.warn(
      error
    );


    updateSyncStatus(
      false
    );

  }

}


/* ============================================================
   CSV FALLBACK
============================================================ */

async function loadCsv() {

  try {

    const response =
      await fetch(
        CONFIG.CSV_FILE,
        {
          cache:
            "no-store"
        }
      );


    if (
      !response.ok
    ) {

      return [];

    }


    const text =
      await response.text();


    const parsed =
      Papa.parse(
        text.trim(),
        {
          header:
            true,

          skipEmptyLines:
            true
        }
      );


    return parsed.data;

  } catch (_) {

    return [];

  }

}


/* ============================================================
   NORMALIZE DATA
============================================================ */

function normalizeRow(
  row,
  sourceIndex
) {

  const x =
    Number(
      row["Map X"]
    );


  const y =
    Number(
      row["Map Y"]
    );


  const record = {

    sourceIndex,

    id:
      String(
        row.ID ??
        ""
      ).trim(),

    date:
      String(
        row.Date ??
        ""
      ).trim(),

    time:
      String(
        row.Time ??
        ""
      ).trim(),

    pasture:
      String(
        row.Pasture ??
        ""
      ).trim(),

    x:
      Number.isFinite(x)
        ? x
        : null,

    y:
      Number.isFinite(y)
        ? y
        : null,

    notes:
      String(
        row.Notes ??
        ""
      ).trim(),

    updatedAt:
      String(
        row["Updated At"] ??
        ""
      ).trim()

  };


  record.dateTime =
    parseDateTime(
      record
    );


  return record;

}


function recordSignature(
  records
) {

  return records
    .map(
      record =>
        [
          record.id,
          record.date,
          record.time,
          record.pasture,
          record.x,
          record.y,
          record.notes,
          record.updatedAt
        ].join("|")
    )
    .join("||");

}


/* ============================================================
   DRAW EVERYTHING
============================================================ */

function drawEverything() {

  drawPastures();

  drawPaths(
    sortedRecords()
  );

  drawMarkers();

  updateStatus();

}


/* ============================================================
   MARKERS
============================================================ */

function drawMarkers() {

  markerLayer.clearLayers();


  const records =
    sortedRecords();


  records.forEach(
    record => {

      if (
        record.x === null ||
        record.y === null
      ) {
        return;
      }


      if (
        selectedPastureFilter &&
        normalizePastureId(
          record.pasture ||
          pastureAt(
            record.x,
            record.y
          )
        ) !==
        normalizePastureId(
          selectedPastureFilter
        )
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
                record
              ),

            zIndexOffset:
              isLastRecord(
                record
              )
                ? 1000
                : 0
          }
        )
          .addTo(
            markerLayer
          );


      marker.bindPopup(
        recordPopup(
          record
        )
      );


      /*
        IMPORTANT:

        Clicking a pin does NOT remove it.

        It remains exactly where it was logged.
      */

      marker.on(
        "click",
        () => {

          marker.openPopup();

        }
      );

    }
  );

}


/* ============================================================
   PIN ICON
============================================================ */

function makeFlerdIcon(
  record
) {

  const latest =
    isLastRecord(
      record
    );


  const iconUrl =
    record.sourceIndex % 2 === 0
      ? CONFIG.COW_ICON
      : CONFIG.SHEEP_ICON;


  const size =
    latest
      ? 42
      : 34;


  return L.divIcon({

    className:
      "flerd-marker",

    html: `

      <div
        class="${
          latest
            ? "flerd-marker-inner latest"
            : "flerd-marker-inner"
        }">

        <img
          src="${esc(iconUrl)}"
          alt="Flerd location">

      </div>

    `,

    iconSize:
      [
        size,
        size
      ],

    iconAnchor:
      [
        size / 2,
        size / 2
      ]

  });

}


/* ============================================================
   POPUP
============================================================ */

function recordPopup(
  record
) {

  return `

    <div class="location-popup">

      <strong>
        ${esc(
          formatDate(
            record.dateTime
          )
        )}
      </strong>

      <br>

      ${esc(
        formatTime(
          record.dateTime,
          record.time
        )
      )}

      <br>

      <span>
        ${
          record.pasture
            ? `Pasture ${esc(record.pasture)}`
            : "Outside pasture"
        }
      </span>

      ${
        record.notes
          ? `
            <div class="popup-notes">
              ${esc(record.notes)}
            </div>
          `
          : ""
      }

      ${
        record.id
          ? `
            <button
              class="popup-edit-btn"
              data-edit-id="${esc(record.id)}">
              Edit this location
            </button>
          `
          : ""
      }

    </div>

  `;

}


/* ============================================================
   PATHS
============================================================ */

function drawPaths(
  records
) {

  pathLayer.clearLayers();


  if (
    selectedPastPathStart &&
    selectedPastPathEnd
  ) {

    drawDateRangePath(
      records
    );

    return;

  }


  /*
    Normal map:
    shows the most recent seven days.
  */

  if (
    records.length < 2
  ) {
    return;
  }


  const newest =
    records[
      records.length - 1
    ];


  if (
    !newest.dateTime
  ) {
    return;
  }


  const cutoff =
    new Date(
      newest.dateTime.getTime() -
      7 *
      24 *
      60 *
      60 *
      1000
    );


  const recent =
    records.filter(
      record =>
        record.dateTime &&
        record.dateTime >= cutoff &&
        record.x !== null &&
        record.y !== null
    );


  drawPolylineSegments(
    recent,
    "recent"
  );

}


function drawDateRangePath(
  records
) {

  const filtered =
    records.filter(
      record =>

        recordIsInRange(
          record
        ) &&

        record.x !== null &&
        record.y !== null

    );


  if (
    filtered.length < 2
  ) {

    return;

  }


  if (
    selectedPastPathScope ===
    "all"
  ) {

    drawPolylineSegments(
      filtered,
      "range"
    );

    return;

  }


  for (
    let i = 1;
    i < filtered.length;
    i++
  ) {

    const previous =
      filtered[i - 1];

    const current =
      filtered[i];


    if (
      segmentTouchesPasture(
        [
          previous.x,
          previous.y
        ],
        [
          current.x,
          current.y
        ],
        selectedPastPathScope
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

          color:
            "#111",

          weight:
            4,

          opacity:
            0.9,

          lineJoin:
            "round",

          lineCap:
            "round"

        }
      ).addTo(
        pathLayer
      );

    }

  }

}


function drawPolylineSegments(
  records,
  type
) {

  if (
    records.length < 2
  ) {
    return;
  }


  L.polyline(
    records.map(
      record =>
        [
          record.y,
          record.x
        ]
    ),
    {

      color:
        "#111",

      weight:
        type === "range"
          ? 4
          : 3,

      opacity:
        type === "range"
          ? 0.9
          : 0.65,

      lineJoin:
        "round",

      lineCap:
        "round"

    }
  ).addTo(
    pathLayer
  );

}


/* ============================================================
   PASTURE GEOMETRY
============================================================ */

function pastureAt(
  x,
  y
) {

  for (
    const pasture of pastureData
  ) {

    if (
      pointInPolygon(
        [x, y],
        pasture.polygon
      )
    ) {

      return normalizePastureId(
        pasture.group ||
        pasture.id
      );

    }

  }


  return "";

}


function pointInPolygon(
  point,
  polygon
) {

  const [
    x,
    y
  ] = point;


  let inside =
    false;


  for (
    let i = 0,
    j = polygon.length - 1;

    i < polygon.length;

    j = i++
  ) {

    const xi =
      polygon[i][0];

    const yi =
      polygon[i][1];


    const xj =
      polygon[j][0];

    const yj =
      polygon[j][1];


    const intersects =
      (
        (yi > y) !==
        (yj > y)
      ) &&
      (
        x <
        (
          (xj - xi) *
          (y - yi)
        ) /
        (
          (yj - yi) ||
          1e-9
        ) +
        xi
      );


    if (
      intersects
    ) {

      inside =
        !inside;

    }

  }


  return inside;

}


function pasturePolygons(
  id
) {

  const normalized =
    normalizePastureId(
      id
    );


  return pastureData
    .filter(
      pasture =>
        normalizePastureId(
          pasture.group ||
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
  id
) {

  const polygons =
    pasturePolygons(
      id
    );


  for (
    const polygon of polygons
  ) {

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

      const p1 =
        polygon[i];

      const p2 =
        polygon[
          (i + 1) %
          polygon.length
        ];


      if (
        segmentsIntersect(
          a,
          b,
          p1,
          p2
        )
      ) {

        return true;

      }

    }

  }


  return false;

}


function orientation(
  a,
  b,
  c
) {

  const value =
    (
      b[1] - a[1]
    ) *
    (
      c[0] - b[0]
    ) -
    (
      b[0] - a[0]
    ) *
    (
      c[1] - b[1]
    );


  if (
    Math.abs(
      value
    ) < 1e-9
  ) {

    return 0;

  }


  return value > 0
    ? 1
    : 2;

}


function onSegment(
  a,
  b,
  c
) {

  return (

    b[0] <=
      Math.max(
        a[0],
        c[0]
      ) &&

    b[0] >=
      Math.min(
        a[0],
        c[0]
      ) &&

    b[1] <=
      Math.max(
        a[1],
        c[1]
      ) &&

    b[1] >=
      Math.min(
        a[1],
        c[1]
      )

  );

}


function segmentsIntersect(
  p1,
  q1,
  p2,
  q2
) {

  const o1 =
    orientation(
      p1,
      q1,
      p2
    );


  const o2 =
    orientation(
      p1,
      q1,
      q2
    );


  const o3 =
    orientation(
      p2,
      q2,
      p1
    );


  const o4 =
    orientation(
      p2,
      q2,
      q1
    );


  if (
    o1 !== o2 &&
    o3 !== o4
  ) {

    return true;

  }


  if (
    o1 === 0 &&
    onSegment(
      p1,
      p2,
      q1
    )
  ) {

    return true;

  }


  if (
    o2 === 0 &&
    onSegment(
      p1,
      q2,
      q1
    )
  ) {

    return true;

  }


  if (
    o3 === 0 &&
    onSegment(
      p2,
      p1,
      q2
    )
  ) {

    return true;

  }


  if (
    o4 === 0 &&
    onSegment(
      p2,
      q1,
      q2
    )
  ) {

    return true;

  }


  return false;

}


/* ============================================================
   DATE RANGE
============================================================ */

function populatePastureSelectors() {

  const select =
    $("pastPathScope");


  select.innerHTML =
    `
      <option value="all">
        Total property
      </option>
    `;


  pastureGroups()
    .forEach(
      (group, id) => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          id;


        option.textContent =
          `Pasture ${id}`;


        select.appendChild(
          option
        );

      }
    );

}


function showPastPath() {

  const start =
    $("pastPathStart")
      .value;


  const end =
    $("pastPathEnd")
      .value;


  if (
    !start ||
    !end
  ) {

    $("pastPathStatus")
      .textContent =
      "Please choose both dates.";

    return;

  }


  if (
    start > end
  ) {

    $("pastPathStatus")
      .textContent =
      "The start date must be before the end date.";

    return;

  }


  selectedPastPathStart =
    start;


  selectedPastPathEnd =
    end;


  selectedPastPathScope =
    $("pastPathScope")
      .value;


  const count =
    sortedRecords()
      .filter(
        record =>

          recordIsInRange(
            record
          ) &&

          (
            selectedPastPathScope ===
            "all" ||

            normalizePastureId(
              record.pasture ||
              pastureAt(
                record.x,
                record.y
              )
            ) ===
            normalizePastureId(
              selectedPastPathScope
            )
          )
      )
      .length;


  $("pastPathStatus")
    .textContent =
    `${count} location${count === 1 ? "" : "s"} found.`;


  drawEverything();

}


function clearPastPath() {

  selectedPastPathStart =
    null;

  selectedPastPathEnd =
    null;

  selectedPastPathScope =
    "all";


  $("pastPathStart")
    .value =
    "";

  $("pastPathEnd")
    .value =
    "";

  $("pastPathScope")
    .value =
    "all";


  $("pastPathStatus")
    .textContent =
    "";


  drawEverything();

}


function recordIsInRange(
  record
) {

  if (
    !record.dateTime ||
    !selectedPastPathStart ||
    !selectedPastPathEnd
  ) {

    return false;

  }


  const key =
    dateKey(
      record.dateTime
    );


  return (
    key >=
    selectedPastPathStart &&
    key <=
    selectedPastPathEnd
  );

}


/* ============================================================
   STATUS
============================================================ */

function updateStatus() {

  const records =
    sortedRecords();


  if (
    !records.length
  ) {

    $("lastSeenText")
      .textContent =
      "No location yet";

    return;

  }


  const last =
    records[
      records.length - 1
    ];


  $("lastSeenText")
    .innerHTML = `

      <strong>
        ${esc(
          formatDate(
            last.dateTime
          )
        )}
      </strong>

      <br>

      ${esc(
        formatTime(
          last.dateTime,
          last.time
        )
      )}

      <br>

      ${
        last.pasture
          ? `Pasture ${esc(last.pasture)}`
          : "Outside pasture"
      }

    `;

}


function updateSyncStatus(
  success
) {

  const now =
    new Date();


  if (success) {

    $("syncStatus")
      .textContent =
      `Synced · ${now.toLocaleTimeString(
        [],
        {
          hour:
            "numeric",

          minute:
            "2-digit"
        }
      )}`;


    $("syncDetail")
      .textContent =
      "Google Sheets synched";

  } else {

    $("syncStatus")
      .textContent =
      "Sync unavailable";


    $("syncDetail")
      .textContent =
      "Could not sync with Google Sheets";

  }

}


/* ============================================================
   ADMIN
============================================================ */

let administratorKey =
  null;


function openAdmin() {

  $("adminPanel")
    .classList.remove(
      "hidden"
    );


  if (
    administratorKey
  ) {

    showAdminControls();

  } else {

    $("adminLogin")
      .classList.remove(
        "hidden"
      );

    $("adminControls")
      .classList.add(
        "hidden"
      );

  }

}


function closeAdmin() {

  $("adminPanel")
    .classList.add(
      "hidden"
    );

}


function adminLogin() {

  const key =
    $("adminKey")
      .value
      .trim();


  if (!key) {

    showToast(
      "Enter the administrator key."
    );

    return;

  }


  /*
    The key is not validated until a boundary save.

    The Apps Script validates it against Script Properties.
  */

  administratorKey =
    key;


  showAdminControls();


  $("boundaryStatus")
    .textContent =
    pastureLocked
      ? "Boundaries are currently LOCKED."
      : "Boundaries are currently unlocked.";

}


function showAdminControls() {

  $("adminLogin")
    .classList.add(
      "hidden"
    );


  $("adminControls")
    .classList.remove(
      "hidden"
    );


  $("boundaryStatus")
    .textContent =
    pastureLocked
      ? "Boundaries are locked."
      : "Boundaries are unlocked.";

}


/* ============================================================
   BOUNDARY EDITING
============================================================ */

function beginBoundaryEditing() {

  if (
    !administratorKey
  ) {

    showToast(
      "Admin access required."
    );

    return;

  }


  boundaryEditMode =
    true;


  $("editBoundariesBtn")
    .classList.add(
      "hidden"
    );


  $("saveBoundariesBtn")
    .classList.remove(
      "hidden"
    );


  $("cancelBoundaryEditBtn")
    .classList.remove(
      "hidden"
    );


  boundaryEditLayer
    .clearLayers();


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

                draggable:
                  true,

                icon:
                  L.divIcon({

                    className:
                      "boundary-handle",

                    html:
                      `<div></div>`,

                    iconSize:
                      [
                        18,
                        18
                      ],

                    iconAnchor:
                      [
                        9,
                        9
                      ]

                  }),

                zIndexOffset:
                  3000

              }
            );


          marker.bindTooltip(
            pasture.name,
            {
              direction:
                "top"
            }
          );


          marker.on(
            "drag",
            () => {

              const position =
                marker.getLatLng();


              pastureData[
                pastureIndex
              ].polygon[
                pointIndex
              ] = [

                Math.round(
                  position.lng
                ),

                Math.round(
                  position.lat
                )

              ];


              drawPasturePreview();

            }
          );


          marker.addTo(
            boundaryEditLayer
          );

        }
      );

    }
  );


  drawPasturePreview();


  $("boundaryStatus")
    .textContent =
    "Editing boundaries. Drag/adjust the points.";

}


function drawPasturePreview() {

  pastureLayer.clearLayers();


  pastureData.forEach(
    pasture => {

      L.polygon(
        pasture.polygon.map(
          ([x, y]) =>
            [y, x]
        ),
        {

          color:
            "#111",

          weight:
            3,

          fillColor:
            pasture.color,

          fillOpacity:
            0.2

        }
      ).addTo(
        pastureLayer
      );

    }
  );

}


async function saveBoundaryChanges() {

  if (
    !administratorKey
  ) {

    return;

  }


  $("saveBoundariesBtn")
    .disabled =
    true;


  $("saveBoundariesBtn")
    .textContent =
    "Saving…";


  try {

    await submitToAppsScript({

      action:
        "savePastures",

      adminKey:
        administratorKey,

      pastures:
        pastureData

    });


    /*
      Verify by reading the configuration back.
    */

    await loadPastures();


    pastureLocked =
      true;


    boundaryEditMode =
      false;


    boundaryEditLayer
      .clearLayers();


    drawPastures();


    $("boundaryStatus")
      .textContent =
      "Boundaries saved and locked.";


    $("editBoundariesBtn")
      .classList.remove(
        "hidden"
      );


    $("saveBoundariesBtn")
      .classList.add(
        "hidden"
      );


    $("cancelBoundaryEditBtn")
      .classList.add(
        "hidden"
      );


    showToast(
      "Pasture boundaries saved and locked."
    );


  } catch (error) {

    console.error(
      error
    );


    showToast(
      "Boundary save failed..."
    );

  } finally {

    $("saveBoundariesBtn")
      .disabled =
      false;


    $("saveBoundariesBtn")
      .textContent =
      "Save & lock boundaries";

  }

}


function cancelBoundaryEditing() {

  boundaryEditMode =
    false;


  boundaryEditLayer
    .clearLayers();


  /*
    Reload the saved configuration so unsaved
    dragging is discarded.
  */

  loadPastures()
    .then(
      () => {

        drawPastures();

      }
    );


  $("editBoundariesBtn")
    .classList.remove(
      "hidden"
    );


  $("saveBoundariesBtn")
    .classList.add(
      "hidden"
    );


  $("cancelBoundaryEditBtn")
    .classList.add(
      "hidden"
    );


  $("boundaryStatus")
    .textContent =
    "Boundary changes cancelled.";

}


/* ============================================================
   DATE/TIME HELPERS
============================================================ */

function parseDateTime(
  record
) {

  if (
    !record.date
  ) {

    return null;

  }


  const parts =
    record.date
      .split(
        /[\/-]/
      )
      .map(Number);


  if (
    parts.length <
    2
  ) {

    return null;

  }


  const month =
    parts[0];


  const day =
    parts[1];


  let year =
    parts[2] ||
    new Date()
      .getFullYear();


  if (
    year < 100
  ) {

    year +=
      2000;

  }


  let hour =
    12;


  let minute =
    0;


  const time =
    String(
      record.time ||
      ""
    )
      .trim()
      .toUpperCase();


  const match =
    time.match(
      /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/
    );


  if (match) {

    hour =
      Number(
        match[1]
      );


    minute =
      Number(
        match[2] ||
        0
      );


    if (
      match[3] ===
      "PM" &&
      hour < 12
    ) {

      hour +=
        12;

    }


    if (
      match[3] ===
      "AM" &&
      hour === 12
    ) {

      hour =
        0;

    }

  }


  const result =
    new Date(
      year,
      month - 1,
      day,
      hour,
      minute
    );


  return Number.isNaN(
    result.getTime()
  )
    ? null
    : result;

}


function formatDate(
  date
) {

  if (
    !date
  ) {

    return "Unknown date";

  }


  return date.toLocaleDateString(
    undefined,
    {
      month:
        "short",

      day:
        "numeric",

      year:
        "numeric"
    }
  );

}


function formatTime(
  date,
  raw
) {

  if (
    !date
  ) {

    return raw ||
      "Unknown time";

  }


  return date.toLocaleTimeString(
    undefined,
    {
      hour:
        "numeric",

      minute:
        "2-digit"
    }
  );

}


function dateKey(
  date
) {

  return (

    date.getFullYear() +

    "-" +

    String(
      date.getMonth() + 1
    )
      .padStart(
        2,
        "0"
      ) +

    "-" +

    String(
      date.getDate()
    )
      .padStart(
        2,
        "0"
      )

  );

}


function fromDateInput(
  value
) {

  if (!value) {
    return new Date();
  }


  const [
    year,
    month,
    day
  ] =
    value
      .split("-")
      .map(Number);


  return new Date(
    year,
    month - 1,
    day
  );

}


function formatDateForSheet(
  date
) {

  return (

    date.getMonth() + 1 +

    "/" +

    date.getDate() +

    "/" +

    date.getFullYear()

  );

}


function formatTimeForSheet(
  date
) {

  return date.toLocaleTimeString(
    undefined,
    {
      hour:
        "numeric",

      minute:
        "2-digit"
    }
  );

}


function formatTimeInputForSheet(
  value
) {

  if (!value) {

    return "";

  }


  const [
    hourRaw,
    minute
  ] =
    value
      .split(":")
      .map(Number);


  const suffix =
    hourRaw >= 12
      ? "PM"
      : "AM";


  const hour =
    hourRaw % 12 ||
    12;


  return `${hour}:${String(
    minute
  ).padStart(
    2,
    "0"
  )} ${suffix}`;

}


function toDateInputValue(
  record
) {

  if (
    !record.dateTime
  ) {

    return "";

  }


  return dateKey(
    record.dateTime
  );

}


function toTimeInputValue(
  record
) {

  if (
    !record.dateTime
  ) {

    return "";

  }


  return (

    String(
      record.dateTime
        .getHours()
    ).padStart(
      2,
      "0"
    ) +

    ":" +

    String(
      record.dateTime
        .getMinutes()
    ).padStart(
      2,
      "0"
    )

  );

}


/* ============================================================
   SORTING
============================================================ */

function sortedRecords() {

  return [
    ...allRecords
  ]
    .filter(
      record =>
        record.dateTime
    )
    .sort(
      (a, b) =>
        a.dateTime -
        b.dateTime
    );

}


function isLastRecord(
  record
) {

  const records =
    sortedRecords();


  return (
    records.length > 0 &&
    records[
      records.length - 1
    ] === record
  );

}


/* ============================================================
   TOAST
============================================================ */

function showToast(
  message
) {

  const toast =
    $("toast");


  toast.textContent =
    message;


  toast.classList.add(
    "show"
  );


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(
      () => {

        toast.classList.remove(
          "show"
        );

      },
      3000
    );

}


/* ============================================================
   BEGIN
============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  start
);
