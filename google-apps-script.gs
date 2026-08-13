const SHEET_ID =
  "1F3Xq6CUxDP0nAT9VbPB1PSEeYB4KvBP0FWehBHiajKA";

const SHEET_NAME = "Log";



function doGet(e) {
  const action =
    (e.parameter.action || "getLocations").toString();

  if (action === "getLocations") {
    const rows = getLocationRows();
    return jsonp(
      e.parameter.callback,
      rows
    );
  }

  return jsonp(
    e.parameter.callback,
    { ok: true }
  );
}

function doPost(e) {
  try {
    const payload =
      JSON.parse(
        e.parameter.payload || "{}"
      );

    if (
      payload.action === "savePastures"
    ) {
      savePastures(
        payload.pastures
      );

      return textResponse({
        ok: true
      });
    }

    const result =
      saveLocation(
        payload
      );

    return textResponse(
      result
    );

  } catch (error) {
    return textResponse({
      ok: false,
      error: String(error)
    });
  }
}

function getLocationSheet() {
  return SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(SHEET_NAME);
}

function getLocationRows() {
  const sheet =
    getLocationSheet();

  const values =
    sheet.getDataRange()
      .getValues();

  if (values.length < 2) {
    return [];
  }

  const headers =
    values[0].map(
      value => String(value)
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

function saveLocation(payload) {
  const sheet =
    getLocationSheet();

  const headers =
    getHeaders(
      sheet
    );

  ensureHeaders(
    sheet,
    headers
  );

  let id =
    String(
      payload.ID || ""
    ).trim();

  if (!id) {
    id =
      "FL-" +
      new Date().getTime() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 7);
  }

  const updatedAt =
    new Date().toISOString();

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
      updatedAt
  };

  const idColumn =
    headers.indexOf("ID") + 1;

  const idValues =
    sheet
      .getRange(
        2,
        idColumn,
        Math.max(
          sheet.getLastRow() - 1,
          1
        ),
        1
      )
      .getValues();

  let foundRow = -1;

  for (
    let i = 0;
    i < idValues.length;
    i++
  ) {
    if (
      String(
        idValues[i][0]
      ) === id
    ) {
      foundRow = i + 2;
      break;
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
      id
    };
  }

  sheet.appendRow(
    output
  );

  return {
    ok: true,
    action: "added",
    id
  };
}

function getHeaders(sheet) {
  const lastColumn =
    Math.max(
      sheet.getLastColumn(),
      8
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

  if (
    headers.every(
      header => header === ""
    )
  ) {
    headers = required.slice();
  }

  required.forEach(
    header => {
      if (
        !headers.includes(
          header
        )
      ) {
        headers.push(
          header
        );
      }
    }
  );

  return headers;
}

function ensureHeaders(
  sheet,
  headers
) {
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
}

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

/*
  Optional helper if you later want pasture
  boundaries stored in Google Sheets too.

  The current website saves edited boundaries
  in localStorage, so you do not need this yet.
*/
function savePastures(pastures) {
  const ss =
    SpreadsheetApp
      .openById(SHEET_ID);

  let sheet =
    ss.getSheetByName(
      "Pastures"
    );

  if (!sheet) {
    sheet =
      ss.insertSheet(
        "Pastures"
      );
  }

  sheet.clear();

  sheet
    .getRange(
      1,
      1,
      1,
      3
    )
    .setValues([
      [
        "Pasture",
        "Color",
        "Polygon JSON"
      ]
    ]);

  const rows =
    (pastures || [])
      .map(
        pasture => [
          pasture.id,
          pasture.color || "",
          JSON.stringify(
            pasture.polygon
          )
        ]
      );

  if (rows.length) {
    sheet
      .getRange(
        2,
        1,
        rows.length,
        3
      )
      .setValues(
        rows
      );
  }
}
