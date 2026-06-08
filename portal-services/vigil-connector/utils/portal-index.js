'use strict';

const { getClient } = require('./opensearch');

const INCIDENTS_INDEX = process.env.VIGIL_PORTAL_INCIDENTS_INDEX || 'forensic-portal-incidents';
const TICKETS_INDEX = process.env.VIGIL_PORTAL_TICKETS_INDEX || 'forensic-portal-tickets';
const E2E_INDEX = process.env.VIGIL_E2E_INDEX || 'vigil-e2e-runs';

async function indexDoc(index, id, doc) {
  const os = getClient();
  await os.index({
    index,
    id,
    body: { ...doc, '@timestamp': doc['@timestamp'] || new Date().toISOString() },
    refresh: 'wait_for',
  });
  return { ok: true, id, index };
}

async function createCertIncident(incident) {
  return indexDoc(INCIDENTS_INDEX, incident.id, incident);
}

async function createItTicket(ticket) {
  return indexDoc(TICKETS_INDEX, ticket.id, ticket);
}

async function saveE2eRun(run) {
  return indexDoc(E2E_INDEX, run.id, run);
}

async function getLastE2eRun() {
  try {
    const os = getClient();
    const r = await os.search({
      index: E2E_INDEX,
      body: { size: 1, sort: [{ '@timestamp': { order: 'desc' } }], query: { match_all: {} } },
    });
    const hit = r.body.hits?.hits?.[0];
    return hit ? { id: hit._id, ...hit._source } : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  createCertIncident,
  createItTicket,
  saveE2eRun,
  getLastE2eRun,
  INCIDENTS_INDEX,
  TICKETS_INDEX,
  E2E_INDEX,
};
