const SHEET_ID =
  "1F3Xq6CUxDP0nAT9VbPB1PSEeYB4KvBP0FWehBHiajKA";

const SHEET_NAME = "Log";


const HEADERS = [
  "Date",
  "Time",
  "Pasture",
  "Map X",
  "Map Y",
  "Notes",
  "ID",
  "Updated At"
];


function getSheet_() {

  const ss =
    SpreadsheetApp.openById(SHEET_ID);

  const sheet =
    ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    throw new Error(
      `Sheet "${SHEET_NAME}" not found.`
    );
  }

  return sheet;
}


function ensureHeaders_(sheet) {

  sheet
    .getRange(
      1,
      1,
      1,
      HEADERS.length
    )
    .setValues([HEADERS]);


  /*
    Give old records permanent IDs.
  */

  const lastRow =
    sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }


  const idRange =
    sheet.getRange(
      2,
      7,
      lastRow - 1,
      1
    );


  const ids =
    idRange.getValues();


  let changed = false;


  for (let i = 0; i < ids.length; i++) {

    if (!ids[i][0]) {

      ids[i][0] =
        Utilities.getUuid();

      changed = true;

    }

  }


  if (changed) {
    idRange.setValues(ids);
  }

}


function rowsAsObjects_(sheet) {

  const values =
    sheet
      .getDataRange()
      .getDisplayValues();


  if (values.length <= 1) {
    return [];
  }


  return values
    .slice(1)
    .map(row => {

      const obj = {};

      HEADERS.forEach(
        (header, i) => {

          obj[header] =
            row[i] ?? "";

        }
      );

      return obj;

    })
    .filter(obj =>
      obj.ID ||
      obj.Date ||
      obj.Time ||
      obj.Pasture ||
      obj.Notes
    );

}


function doGet(e) {

  const sheet =
    getSheet_();

  ensureHeaders_(sheet);


  const rows =
    rowsAsObjects_(sheet);


  const callback =
    e &&
    e.parameter &&
    e.parameter.callback;


  /*
    JSONP lets the GitHub Pages website
    read the Google Apps Script response
    without a CORS problem.
  */

  if (callback) {

    const safeCallback =
      String(callback)
        .replace(/[^\w.$]/g, "");


    return ContentService
      .createTextOutput(
        `${safeCallback}(${JSON.stringify(rows)})`
      )
      .setMimeType(
        ContentService.MimeType.JAVASCRIPT
      );

  }


  return ContentService
    .createTextOutput(
      JSON.stringify(rows)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}


function findRowById_(sheet, id) {

  const lastRow =
    sheet.getLastRow();


  if (
    lastRow < 2 ||
    !id
  ) {
    return -1;
  }


  const ids =
    sheet
      .getRange(
        2,
        7,
        lastRow - 1,
        1
      )
      .getDisplayValues();


  const target =
    String(id).trim();


  for (
    let i = 0;
    i < ids.length;
    i++
  ) {

    if (
      String(ids[i][0]).trim()
      === target
    ) {

      return i + 2;

    }

  }


  return -1;
}


function writeRecord_(sheet, payload) {

  const id =
    String(payload.ID || "").trim()
    || Utilities.getUuid();


  const updatedAt =
    new Date().toISOString();


  const row = [

    payload.Date || "",

    payload.Time || "",

    payload.Pasture || "",

    payload["Map X"] ?? "",

    payload["Map Y"] ?? "",

    payload.Notes || "",

    id,

    updatedAt

  ];


  /*
    If the ID already exists,
    update that row.

    Otherwise create a new row.
  */

  const existingRow =
    findRowById_(sheet, id);


  if (existingRow > 0) {

    sheet
      .getRange(
        existingRow,
        1,
        1,
        HEADERS.length
      )
      .setValues([row]);


    return {
      ok: true,
      action: "updated",
      ID: id
    };

  }


  sheet.appendRow(row);


  return {
    ok: true,
    action: "created",
    ID: id
  };

}


function doPost(e) {

  const sheet =
    getSheet_();

  ensureHeaders_(sheet);


  if (
    !e ||
    !e.parameter ||
    !e.parameter.payload
  ) {

    return ContentService
      .createTextOutput(
        JSON.stringify({
          ok: false,
          error: "Missing payload"
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }


  try {

    const payload =
      JSON.parse(
        e.parameter.payload
      );


    const result =
      writeRecord_(
        sheet,
        payload
      );


    return ContentService
      .createTextOutput(
        JSON.stringify(result)
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }

  catch (error) {

    return ContentService
      .createTextOutput(
        JSON.stringify({
          ok: false,
          error: String(error)
        })
      )
      .setMimeType(
        ContentService.MimeType.JSON
      );

  }

} 
