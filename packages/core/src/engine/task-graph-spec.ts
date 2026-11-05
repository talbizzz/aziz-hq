import { z } from 'zod';
import { gateKind, gateOptionSchema, taskType } from '../domain/enums.js';

export const taskSpecSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  type: taskType,
  role: z.string().min(1).optional(),
  title: z.string().min(1),
  depends_on: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  max_attempts: z.number().int().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  gate: z
    .object({
      kind: gateKind,
      title: z.string().min(1).optional(),
      priority: z.number().int().min(0).max(2).optional(),
      context: z.record(z.string(), z.unknown()).optional(),
      options: z.array(gateOptionSchema).optional(),
    })
    .optional(),
});

export const taskGraphSpecSchema = z.array(taskSpecSchema).max(500);

export type TaskSpec = z.input<typeof taskSpecSchema>;
