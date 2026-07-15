import { z } from 'zod';

const region = z.string().min(1).max(64).default('delhi');

export const nearbyQuerySchema = z.object({
  region,
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // Bounded, not open-ended: an unbounded radius is a full table scan wearing a costume.
  radius: z.coerce.number().int().min(50).max(5000).default(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchQuerySchema = z.object({
  region,
  q: z.string().trim().min(2).max(64),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
