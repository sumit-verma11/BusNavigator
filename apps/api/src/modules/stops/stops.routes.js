import { Router } from 'express';
import { nearbyQuerySchema, searchQuerySchema } from './stops.schema.js';
import { findNearbyStops, searchStops } from './stops.service.js';

export const stopsRouter = Router();

stopsRouter.get('/nearby', async (req, res, next) => {
  try {
    const params = nearbyQuerySchema.parse(req.query);
    res.json({ data: await findNearbyStops(params) });
  } catch (err) {
    next(err);
  }
});

stopsRouter.get('/search', async (req, res, next) => {
  try {
    const params = searchQuerySchema.parse(req.query);
    res.json({ data: await searchStops(params) });
  } catch (err) {
    next(err);
  }
});
