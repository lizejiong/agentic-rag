import { z } from 'zod';

export const visibleSpaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  effectivePermission: z.enum(['VIEW', 'EDIT', 'MANAGE']),
});

export const visibleSpacesSchema = z.array(visibleSpaceSchema);

export type VisibleSpace = z.infer<typeof visibleSpaceSchema>;
