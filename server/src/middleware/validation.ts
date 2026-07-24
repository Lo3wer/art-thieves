import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { AppError } from './errorHandler';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return next(new AppError(400, messages));
    }
    req.body = result.data;
    next();
  };
}

export const gameMapSchema = z.object({
  name: z.string().min(1),
  center: z.object({ lat: z.number(), lng: z.number() }),
  defaultZoom: z.number().int().min(1).max(20),
  defaultVicinityRadius: z.number().positive(),
  winThreshold: z.number().int().positive(),
  data: z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.any()),
  }),
});

export const createGameSchema = z.object({
  mapId: z.string().uuid(),
  config: z.object({
    duration: z.number().positive(),
    vicinityRadius: z.number().positive(),
    winThreshold: z.number().int().positive(),
    reTagCooldown: z.number().min(0),
    disputeWindow: z.number().positive(),
  }),
});

export const joinGameSchema = z.object({
  name: z.string().min(1).max(30),
  color: z.string().min(1),
});

export const claimSchema = z.object({
  landmarkId: z.string().uuid(),
});

export const challengeSchema = z.object({
  landmarkId: z.string().uuid(),
  outcome: z.enum(['complete', 'fail', 'veto']),
});

export const tagSchema = z.object({
  targetTeamId: z.string().uuid(),
});

export const pushTokenSchema = z.object({
  token: z.string().min(1),
});

export const configUpdateSchema = z.object({
  duration: z.number().positive().optional(),
  vicinityRadius: z.number().positive().optional(),
  winThreshold: z.number().int().positive().optional(),
  reTagCooldown: z.number().min(0).optional(),
  disputeWindow: z.number().positive().optional(),
});
