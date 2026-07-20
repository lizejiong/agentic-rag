export type SpacePermission = 'VIEW' | 'EDIT' | 'MANAGE';

export type AuthorizationSnapshot = {
  userId: string;
  revision: bigint;
  admin: boolean;
  departmentId?: string;
  groupIds: string[];
  spaces: Record<string, SpacePermission>;
};

export type DocumentAccessRequest = {
  documentId: string;
  operation: 'SEARCH' | 'CITATION' | 'PREVIEW' | 'DOWNLOAD';
};

export const permissionRank: Record<SpacePermission, number> = {
  VIEW: 1,
  EDIT: 2,
  MANAGE: 3,
};
