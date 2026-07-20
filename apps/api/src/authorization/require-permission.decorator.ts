import { SetMetadata } from '@nestjs/common';

import type { SpacePermission } from './authorization.types';

export const REQUIRED_SPACE_PERMISSION = 'required-space-permission';

export const RequireSpacePermission = (permission: SpacePermission) =>
  SetMetadata(REQUIRED_SPACE_PERMISSION, permission);
