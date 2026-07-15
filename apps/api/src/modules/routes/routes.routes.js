import { Router } from 'express';
import { routeSearchSchema, routeIdSchema } from './routes.schema.js';
import { searchDirectRoutes, getRouteShape } from './routes.service.js';

export const routesRouter = Router();

routesRouter.get('/search', async (req, res, next) => {
  try {
    const params = routeSearchSchema.parse(req.query);
    res.json({ data: await searchDirectRoutes(params) });
  } catch (err) {
    next(err);
  }
});

routesRouter.get('/:id/shape', async (req, res, next) => {
  try {
    const { id } = routeIdSchema.parse(req.params);
    res.json({ data: await getRouteShape(id) });
  } catch (err) {
    next(err);
  }
});
