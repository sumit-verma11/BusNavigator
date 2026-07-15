import { z } from 'zod';

export const routeSearchSchema = z.object({
  region: z.string().min(1).max(64).default('delhi'),
  from: z.coerce.number().int().positive(), // stop ids from /stops/search or /stops/nearby
  to: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const routeIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});
