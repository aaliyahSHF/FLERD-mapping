const SHEET_ID =
  "1F3Xq6CUxDP0nAT9VbPB1PSEeYB4KvBP0FWehBHiajKA";

const LOG_SHEET_NAME = "Log";
const PASTURE_SHEET_NAME = "Pastures";


/* =========================================================
   GET
========================================================= */

function doGet(e) {

  e = e || {};
  const action =
    String(
      e.parameter.action ||
      "getLocations"
    );


  if (action === "getLocations") {

    return jsonp(
      e.parameter.callback,
      getLocationRows()
    );
  }


  if (action === "getPastures") {

    return jsonp(
      e.parameter.callback,
      getPastureConfiguration()
    );
  }


  return jsonp(
    e.parameter.callback,
    {
      ok: true
    }
  );
}


/* =========================================================
   POST
========================================================= */

function doPost(e) {

  try {

    const payload =
      JSON.parse(
        e.parameter.payload || "{}"
      );


    if (
      payload.action ===
      "saveLocation"
    ) {

      return textResponse(
        saveLocation(payload)
      );
    }


    if (
      payload.action ===
      "savePastures"
    ) {

      return textResponse(
        savePastures(payload)
      );
    }


    return textResponse({
      ok: false,
      error: "Unknown action"
    });

  } catch (error) {

    return textResponse({
      ok: false,
      error: String(error)
    });

  }
}


/* =========================================================
   LOCATION DATA
========================================================= */

function getLocationSheet() {

  return SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(
      LOG_SHEET_NAME
    );
}


function getLocationRows() {

  const sheet =
    getLocationSheet();

  if (!sheet) {
    return [];
  }


  const values =
    sheet
      .getDataRange()
      .getValues();


  if (values.length < 2) {
    return [];
  }


  const headers =
    values[0].map(
      value =>
        String(value).trim()
    );


  return values
    .slice(1)
    .filter(row =>
      row.some(
        value =>
          value !== ""
      )
    )
    .map(row => {

      const object = {};

      headers.forEach(
        (header, index) => {

          object[header] =
            row[index];

        }
      );

      return object;

    });
}


/* =========================================================
   SAVE LOCATION
========================================================= */

function saveLocation(payload) {

  const sheet =
    getLocationSheet();


  if (!sheet) {

    throw new Error(
      'The "Log" sheet doesn't exist.'
    );

  }


  const headers =
    getOrCreateLogHeaders(
      sheet
    );


  let id =
    String(
      payload.ID || ""
    ).trim();


  if (!id) {

    id =
      "FL-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 8);

  }


  const rowObject = {

    "Date":
      payload.Date || "",

    "Time":
      payload.Time || "",

    "Pasture":
      payload.Pasture || "",

    "Map X":
      payload["Map X"] ?? "",

    "Map Y":
      payload["Map Y"] ?? "",

    "Notes":
      payload.Notes || "",

    "ID":
      id,

    "Updated At":
      new Date().toISOString()

  };


  const idColumn =
    headers.indexOf("ID") + 1;


  const lastRow =
    sheet.getLastRow();


  let foundRow =
    -1;


  if (
    idColumn > 0 &&
    lastRow >= 2
  ) {

    const values =
      sheet
        .getRange(
          2,
          idColumn,
          lastRow - 1,
          1
        )
        .getValues();


    for (
      let i = 0;
      i < values.length;
      i++
    ) {

      if (
        String(values[i][0]) === id
      ) {

        foundRow =
          i + 2;

        break;

      }

    }

  }


  const output =
    headers.map(
      header =>
        rowObject[header] ?? ""
    );


  if (foundRow >= 2) {

    sheet
      .getRange(
        foundRow,
        1,
        1,
        headers.length
      )
      .setValues([
        output
      ]);


    return {
      ok: true,
      action: "updated",
      id: id
    };

  }


  sheet.appendRow(
    output
  );


  return {
    ok: true,
    action: "added",
    id: id
  };
}


/* =========================================================
   LOG HEADERS
========================================================= */

function getOrCreateLogHeaders(sheet) {

  const required = [

    "Date",
    "Time",
    "Pasture",
    "Map X",
    "Map Y",
    "Notes",
    "ID",
    "Updated At"

  ];


  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      required.length
    );


  let headers =
    sheet
      .getRange(
        1,
        1,
        1,
        lastColumn
      )
      .getValues()[0]
      .map(
        value =>
          String(value).trim()
      );


  if (
    headers.every(
      header => !header
    )
  ) {

    headers =
      required.slice();

  }


  required.forEach(
    header => {

      if (
        !headers.includes(header)
      ) {

        headers.push(header);

      }

    }
  );


  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([
      headers
    ]);


  return headers;
}


/* =========================================================
   PASTURE DATA
========================================================= */

function getPastureSheet() {

  const ss =
    SpreadsheetApp
      .openById(SHEET_ID);


  let sheet =
    ss.getSheetByName(
      PASTURE_SHEET_NAME
    );


  if (!sheet) {

    sheet =
      ss.insertSheet(
        PASTURE_SHEET_NAME
      );

    initializePastureSheet(
      sheet
    );

  }


  return sheet;
}


function initializePastureSheet(sheet) {

  sheet
    .getRange(
      1,
      1,
      1,
      5
    )
    .setValues([
      [
        "Pasture ID",
        "Name",
        "Color",
        "Polygon JSON",
        "Locked"
      ]
    ]);


  sheet
    .getRange(
      2,
      5
    )
    .setValue(
      "FALSE"
    );
}


/* =========================================================
   READ PASTURES
========================================================= */

function getPastureConfiguration() {

  const sheet =
    getPastureSheet();


  const values =
    sheet
      .getDataRange()
      .getValues();


  if (
    values.length < 2
  ) {

    return {
      exists: false,
      locked: false,
      pastures: []
    };

  }


  const headers =
    values[0].map(
      value =>
        String(value).trim()
    );


  const rows =
    values
      .slice(1)
      .filter(row =>
        row[0] !== ""
      );


  if (!rows.length) {

    return {
      exists: false,
      locked: false,
      pastures: []
    };

  }


  const pastures =
    rows.map(row => {

      let polygon = [];

      try {

        polygon =
          JSON.parse(
            String(
              row[3] || "[]"
            )
          );

      } catch (_) {

        polygon = [];

      }


      return {

        id:
          String(row[0]),

        name:
          String(row[1]),

        color:
          String(row[2]),

        polygon:
          polygon

      };

    });


  const lockedColumn =
    headers.indexOf(
      "Locked"
    );


  let locked = false;


  if (
    lockedColumn >= 0
  ) {

    locked =
      String(
        rows[0][lockedColumn]
      ).toUpperCase() ===
      "TRUE";

  }


  return {

    exists: true,

    locked: locked,

    pastures: pastures

  };
}


/* =========================================================
   SAVE / LOCK PASTURES
========================================================= */

function savePastures(payload) {

  /*
    The admini key is stored as a Script Property.

    Set it in Apps Script:

      Project Settings
      > Script Properties

    Property:
      FLERD_ADMIN_KEY

    Value:
      your chosen administrator key
  */

  const storedKey =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        "FLERD_ADMIN_KEY"
      );


  if (
    !storedKey ||
    String(payload.adminKey) !==
    String(storedKey)
  ) {

    return {
      ok: false,
      error:
        "Denied :( "
    };

  }


  const pastures =
    payload.pastures || [];


  const sheet =
    getPastureSheet();


  sheet.clearContents();


  sheet
    .getRange(
      1,
      1,
      1,
      5
    )
    .setValues([
      [
        "Pasture ID",
        "Name",
        "Color",
        "Polygon JSON",
        "Locked"
      ]
    ]);


  const rows =
    pastures.map(
      pasture => [

        pasture.id,

        pasture.name,

        pasture.color || "",

        JSON.stringify(
          pasture.polygon || []
        ),

        "TRUE"

      ]
    );


  if (rows.length) {

    sheet
      .getRange(
        2,
        1,
        rows.length,
        5
      )
      .setValues(
        rows
      );

  }


  return {
    ok: true,
    locked: true
  };
}


/* =========================================================
   JSONP
========================================================= */

function jsonp(
  callback,
  data
) {

  const json =
    JSON.stringify(data);


  if (!callback) {

    return ContentService
      .createTextOutput(
        json
      )
      .setMimeType(
        ContentService
          .MimeType
          .JSON
      );

  }


  return ContentService
    .createTextOutput(
      callback +
      "(" +
      json +
      ")"
    )
    .setMimeType(
      ContentService
        .MimeType
        .JAVASCRIPT
    );
}


function textResponse(data) {

  return ContentService
    .createTextOutput(
      JSON.stringify(data)
    )
    .setMimeType(
      ContentService
        .MimeType
        .JSON
    );
} 
