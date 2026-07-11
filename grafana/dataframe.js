'use strict';

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let str;
  if (value instanceof Date) {
    str = value.toISOString();
  } else {
    str = String(value);
  }
  if (/[",\n\r]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Converts a Grafana backend data frame (column-oriented: schema.fields[] + data.values[])
 * into an array of row objects keyed by field name.
 */
function frameToRows(frame) {
  const fields = frame.schema?.fields || [];
  const values = frame.data?.values || [];
  const rowCount = values.length ? values[0].length : 0;
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const row = {};
    fields.forEach((field, colIdx) => {
      let v = values[colIdx] ? values[colIdx][i] : null;
      if (field.type === 'time' && typeof v === 'number') {
        v = new Date(v).toISOString();
      } else if (field.type === 'enum' && typeof v === 'number') {
        const enumText = field.config?.type?.enum?.text;
        if (Array.isArray(enumText) && enumText[v] !== undefined) {
          v = enumText[v];
        }
      }
      row[field.name] = v;
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Flattens all frames found in a /api/ds/query response's `results` object into one row set.
 * Response shape: { results: { [refId]: { frames: [ { schema, data } ] } } }
 */
function framesToRows(dsQueryResponse) {
  const results = dsQueryResponse?.results || {};
  let rows = [];
  for (const refId of Object.keys(results)) {
    const frames = results[refId].frames || [];
    for (const frame of frames) {
      rows = rows.concat(frameToRows(frame));
    }
  }
  return rows;
}

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { csvEscape, frameToRows, framesToRows, rowsToCsv };
