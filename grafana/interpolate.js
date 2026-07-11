'use strict';

class UnsupportedDatasourceError extends Error {
  constructor(dsType, panelId) {
    super(`datasource type '${dsType || 'unknown'}' not yet supported for CSV export (panel ${panelId})`);
    this.name = 'UnsupportedDatasourceError';
    this.dsType = dsType;
    this.panelId = panelId;
  }
}

function getTemplatingDefaults(dashboardJson) {
  const list = dashboardJson?.dashboard?.templating?.list || [];
  const defaults = {};
  for (const v of list) {
    if (v.current && v.current.value !== undefined) {
      defaults[v.name] = Array.isArray(v.current.value) ? v.current.value.join(',') : v.current.value;
    }
  }
  return defaults;
}

function interpolateString(str, varsMap) {
  if (typeof str !== 'string') return str;
  return str.replace(/\$\{(\w+)(?::\w+)?\}|\$(\w+)\b|\[\[(\w+)\]\]/g, (match, a, b, c) => {
    const name = a || b || c;
    return Object.prototype.hasOwnProperty.call(varsMap, name) ? varsMap[name] : match;
  });
}

function interpolateSqlLikeTarget(target, varsMap) {
  return { ...target, rawSql: interpolateString(target.rawSql, varsMap) };
}

// Registry of per-datasource-type interpolators. Add an entry here to support
// a new datasource type; the dispatch/gate logic in csvApi.js doesn't change.
const interpolators = {
  mssql: interpolateSqlLikeTarget,
  mysql: interpolateSqlLikeTarget,
  postgres: interpolateSqlLikeTarget,
};

const SUPPORTED_DS_TYPES = Object.keys(interpolators);

function interpolateQueryTarget(target, varsMap, dsType) {
  const fn = interpolators[dsType];
  if (!fn) throw new UnsupportedDatasourceError(dsType, target.refId);
  return fn(target, varsMap);
}

module.exports = {
  UnsupportedDatasourceError,
  SUPPORTED_DS_TYPES,
  getTemplatingDefaults,
  interpolateString,
  interpolateQueryTarget,
};
