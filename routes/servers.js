'use strict';
const express = require('express');
const router = express.Router();

const serversDb = require('../db/servers');
const client = require('../grafana/client');

router.get('/', (req, res) => {
  res.render('servers/list', { servers: serversDb.list() });
});

router.get('/new', (req, res) => {
  res.render('servers/form', { server: null, error: null });
});

router.post('/', (req, res) => {
  const server = serversDb.create(fieldsFromBody(req.body));
  res.redirect(`/servers?created=${server.id}`);
});

// Literal routes must be registered before the "/:id" catch-all below, otherwise
// Express matches e.g. POST /servers/test as /:id with id="test".
router.post('/test', async (req, res) => {
  const server = fieldsFromBody(req.body);
  const result = await client.testConnection(server);
  res.json(result);
});

router.get('/:id/edit', (req, res) => {
  const server = serversDb.getById(req.params.id);
  if (!server) return res.status(404).send('Server not found');
  res.render('servers/form', { server, error: null });
});

router.post('/:id', (req, res) => {
  serversDb.update(req.params.id, fieldsFromBody(req.body));
  res.redirect('/servers');
});

router.post('/:id/delete', (req, res) => {
  const count = serversDb.countJobsForServer(req.params.id);
  if (count > 0) {
    return res.status(400).send(`Cannot delete: ${count} job(s) still reference this server. Delete or reassign them first.`);
  }
  serversDb.remove(req.params.id);
  res.redirect('/servers');
});

router.post('/:id/test', async (req, res) => {
  const server = serversDb.getById(req.params.id);
  if (!server) return res.status(404).json({ ok: false, message: 'Server not found' });
  const result = await client.testConnection(server);
  res.json(result);
});

function fieldsFromBody(body) {
  return {
    name: body.name,
    base_url: body.base_url,
    auth_method: body.auth_method,
    auth_user: body.auth_user,
    auth_pass: body.auth_pass,
    auth_api_key: body.auth_api_key,
    timeout_s: Number(body.timeout_s) || 30,
    tls_skip_verify: body.tls_skip_verify === 'on' || body.tls_skip_verify === '1',
  };
}

module.exports = router;
