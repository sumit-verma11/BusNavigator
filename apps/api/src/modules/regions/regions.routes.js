import { Router } from 'express';
import { listRegions } from './regions.service.js';

export const regionsRouter = Router();

regionsRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await listRegions() });
  } catch (err) {
    next(err);
  }
});
