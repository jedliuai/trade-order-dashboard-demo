import type { PackagingProfile, PackagingProfileVersion } from './masterDataService';

export type PackagingCopyResolution =
  | { status: 'none' }
  | { status: 'unavailable'; reason: 'version_missing' | 'current_version_unavailable' }
  | {
      status: 'resolved';
      profile: PackagingProfile;
      sourceVersion: PackagingProfileVersion | null;
      upgraded: boolean;
    };

export function resolvePackagingCopyVersion(
  sourceVersionId: string | null | undefined,
  versions: PackagingProfileVersion[],
  currentProfiles: PackagingProfile[]
): PackagingCopyResolution {
  if (!sourceVersionId) return { status: 'none' };

  const exactCurrentProfile = currentProfiles.find((profile) => (
    profile.version_id === sourceVersionId
    && profile.is_active
    && profile.review_status === 'verified'
  ));
  const sourceVersion = versions.find((version) => version.id === sourceVersionId) || null;

  if (exactCurrentProfile) {
    return {
      status: 'resolved',
      profile: exactCurrentProfile,
      sourceVersion,
      upgraded: false
    };
  }
  if (!sourceVersion) return { status: 'unavailable', reason: 'version_missing' };

  const currentProfile = currentProfiles.find((profile) => (
    profile.profile_id === sourceVersion.profile_id
    && profile.is_active
    && profile.review_status === 'verified'
  ));
  if (!currentProfile) return { status: 'unavailable', reason: 'current_version_unavailable' };

  return {
    status: 'resolved',
    profile: currentProfile,
    sourceVersion,
    upgraded: currentProfile.version_id !== sourceVersionId
  };
}
