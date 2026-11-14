import { handleRequest } from '../server.mjs';

export default function cron(req, res) {
  return handleRequest(req, res, '/api/cron');
}

