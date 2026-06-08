'use strict';

const { Client } = require('@opensearch-project/opensearch');

const OS_URL = process.env.OPENSEARCH_URL || 'http://opensearch-node1:9200';
const ALERTS_INDEX = process.env.VIGIL_OS_ALERTS_INDEX || 'vigil-alerts';
const IOC_INDEX = process.env.VIGIL_OS_IOC_INDEX || 'vigil-ioc';
const ASSETS_INDEX = process.env.VIGIL_OS_ASSETS_INDEX || 'vigil-assets';

let client = null;

function getClient() {
  if (!client) client = new Client({ node: OS_URL, ssl: { rejectUnauthorized: false } });
  return client;
}

function docId(prefix, item) {
  return String(item.id || item.uuid || `${prefix}-${item.value || item.hostname || item.title || Date.now()}`);
}

function enrich(kind, item) {
  const ts = item.timestamp || item.last_seen || item.first_seen || new Date().toISOString();
  return {
    ...item,
    '@timestamp': ts,
    _source_platform: 'vigil',
    _collection: kind,
    vigil_kind: kind,
  };
}

async function bulkIndex(index, kind, items) {
  if (!items?.length) return { indexed: 0, errors: 0 };
  const os = getClient();
  const body = items.flatMap((item) => {
    const id = docId(kind, item);
    return [{ index: { _index: index, _id: id } }, enrich(kind, item)];
  });
  try {
    const r = await os.bulk({ body, refresh: false });
    const errors = (r.body.items || []).filter((x) => x.index?.error).length;
    return { indexed: items.length - errors, errors, index };
  } catch (e) {
    return { indexed: 0, errors: items.length, error: e.message, index };
  }
}

async function indexAlerts(items) {
  return bulkIndex(ALERTS_INDEX, 'alerts', items);
}

async function indexIoc(items) {
  return bulkIndex(IOC_INDEX, 'ioc', items);
}

async function indexAssets(items) {
  return bulkIndex(ASSETS_INDEX, 'assets', items);
}

async function clusterHealth() {
  try {
    const os = getClient();
    const r = await os.cluster.health();
    return { ok: true, status: r.body.status, cluster: r.body.cluster_name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function ensureIndices() {
  const os = getClient();
  const specs = [
    { alias: ALERTS_INDEX, pattern: `${ALERTS_INDEX}-*` },
    { alias: IOC_INDEX, pattern: `${IOC_INDEX}-*` },
    { alias: ASSETS_INDEX, pattern: `${ASSETS_INDEX}-*` },
  ];
  const results = [];
  for (const { alias } of specs) {
    const physical = `${alias}-000001`;
    try {
      const exists = await os.indices.exists({ index: physical });
      if (!exists.body) {
        await os.indices.create({
          index: physical,
          body: { aliases: { [alias]: { is_write_index: true } } },
        });
        results.push({ index: physical, created: true });
      } else {
        results.push({ index: physical, created: false });
      }
    } catch (e) {
      results.push({ index: physical, error: e.message });
    }
  }
  return results;
}

module.exports = {
  getClient,
  indexAlerts,
  indexIoc,
  indexAssets,
  clusterHealth,
  ensureIndices,
  ALERTS_INDEX,
  IOC_INDEX,
  ASSETS_INDEX,
};
