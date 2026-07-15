import { z } from 'zod';

export const liveVehiclesSchema = z.object({
  region: z.string().min(1).max(64).default('delhi'),
  // Route id from /routes/search. Live positions are always scoped to a route —
  // "every bus in Delhi" is thousands of markers nobody can read.
  route: z.coerce.number().int().positive(),
});
