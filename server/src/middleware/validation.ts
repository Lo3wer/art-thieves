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

export const createGameSchema = z.object({
  mapId: z.string().min(1),
  config: z.object({
    duration: z.number().positive(),
    vicinityRadius: z.number().positive(),
    winThreshold: z.number().int().positive(),
    reTagCooldown: z.number().min(0),
    disputeWindow: z.number().positive(),
    noTagPeriod: z.number().min(0),
  }),
});

export const joinGameSchema = z.object({
  name: z.string().min(1).max(30),
  color: z.string().min(1),
});

export const claimSchema = z.object({
  landmarkId: z.string().uuid(),
  teamId: z.string().uuid(),
  latitude: z.number(),
  longitude: z.number(),
  photoId: z.string().uuid().optional(),
});

export const photoMetadataSchema = z.object({
  teamId: z.string().uuid(),
  landmarkId: z.string().uuid(),
  // multipart text fields arrive as strings; coerce to numbers
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

export const challengeSpecSchema = z.object({
  text: z.string().min(1),
  mode: z.enum(['instant', 'delayed']),
  instant: z
    .object({
      completeLabel: z.string().optional(),
      completeNote: z.string().optional(),
      vetoLabel: z.string().optional(),
      vetoNote: z.string().optional(),
      penalty: z
        .object({
          type: z.enum(['tracker', 'transit']),
          minutes: z.number().int().positive(),
          note: z.string(),
        })
        .optional(),
    })
    .optional(),
  delayed: z
    .object({
      delayMinutes: z.number().int().positive().optional(),
      returnToLandmark: z.boolean(),
      preCondition: z.string().optional(),
      requiresPhoto: z.boolean().optional(),
      failsIfLockedByOtherTeam: z.boolean().optional(),
    })
    .optional(),
});

export const challengeSchema = z.object({
  landmarkId: z.string().uuid(),
  outcome: z.enum(['complete', 'fail', 'pass']),
  teamId: z.string().uuid(),
  photoId: z.string().uuid().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const tagSchema = z.object({
  targetTeamId: z.string().uuid(),
  teamId: z.string().uuid(),
});

export const pushTokenSchema = z.object({
  token: z.string().min(1),
});

export const debugLandmarkStateSchema = z.object({
  teamId: z.string().uuid(),
  landmarkId: z.string().uuid(),
  holderTeamId: z.string().uuid().nullable(),
  locked: z.boolean(),
});

export const debugChallengeAttemptSchema = z.object({
  teamId: z.string().uuid(),
  landmarkId: z.string().uuid(),
  targetTeamId: z.string().uuid(),
  action: z.enum(['clear-attempt', 'set-pending']),
});

export const configUpdateSchema = z.object({
  duration: z.number().positive().optional(),
  vicinityRadius: z.number().positive().optional(),
  winThreshold: z.number().int().positive().optional(),
  reTagCooldown: z.number().min(0).optional(),
  disputeWindow: z.number().positive().optional(),
  noTagPeriod: z.number().min(0).optional(),
});
