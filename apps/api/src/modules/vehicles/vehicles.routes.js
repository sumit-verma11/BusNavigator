import { Router } from 'express';
import { liveVehiclesSchema } from './vehicles.schema.js';
import { getLiveVehicles } from './vehicles.service.js';

export const vehiclesRouter = Router();

vehiclesRouter.get('/live', async (req, res, next) => {
  try {
    const params = liveVehiclesSchema.parse(req.query);
    const result = await getLiveVehicles(params);

    // Polled every ~10s by the client; never let a proxy serve a cached bus position.
    res.set('Cache-Control', 'no-store');
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});
