import { handleRequest } from '../server.mjs';

export default function tablero(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const rewritten = req.query?.path ?? url.searchParams.get('path');
  const path = url.pathname === '/api/tablero' ? rewritten : url.pathname;
  return handleRequest(req, res, path && path !== '/api/cron' ? path : '/404');
}

