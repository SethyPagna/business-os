// My Profile's avatar flows, as plain functions the modal delegates to
// (U-profile3, refuter X9, 27 Sep 2026). The refuter showed two plausible
// wrong edits -- the upload never attaching the photo to the account, and
// Remove deleting without asking -- that source-shape tests could not see.
// Here each one is behaviour a test drives.

export interface AvatarUploadResult { path?: string | null }
export interface AvatarAttachResult {
  success?: boolean
  error?: string
  avatar_path?: string | null
  updated_at?: string | null
}
export interface AvatarFlowApi {
  uploadUserAvatar: (payload: { filePath: string; fileName: string }) => Promise<AvatarUploadResult | null | undefined>
  setUserAvatar: (userId: number | string, avatarPath: string) => Promise<AvatarAttachResult | null | undefined>
}
export type AvatarFlowStep = 'upload' | 'attach'
// Lets the modal wrap each network step (its loader + per-step timeout).
export type AvatarStepRunner = <T>(step: AvatarFlowStep, fn: () => Promise<T>) => Promise<T>

// Uploads the cropped photo, then ATTACHES it to the account. The upload
// alone only stores the image; until the attach, a reload showed no photo.
// Resolves only once the account holds the photo, so the caller announces
// success after this returns and never before. Throws on either failure.
//
// Sent as a data URL on purpose: uploadUserAvatar routes a File object to the
// general library upload (/api/files/upload), which requires Library or
// Products access -- a cashier's own photo was refused there. The data-URL
// branch posts to /api/users/avatar-upload, open to every signed-in user.
export async function uploadAndAttachAvatar(
  api: AvatarFlowApi,
  userId: number | string,
  dataUrl: string,
  messages: { noPath: string; attachFailed: string },
  run: AvatarStepRunner = (_step, fn) => fn(),
  fallbackUpdatedAt: string | null = null,
): Promise<{ avatar_path: string; updated_at: string | null }> {
  const uploaded = await run('upload', () => api.uploadUserAvatar({ filePath: dataUrl, fileName: 'avatar.png' }))
  const path = String(uploaded?.path || '')
  if (!path) throw new Error(messages.noPath)
  const saved = await run('attach', () => api.setUserAvatar(userId, path))
  if (!saved || saved.success === false) throw new Error(saved?.error || messages.attachFailed)
  // updated_at moves with the photo; carrying it keeps a later "Save
  // profile" from reading as a stale-write conflict.
  return { avatar_path: String(saved.avatar_path || path), updated_at: saved.updated_at ?? fallbackUpdatedAt }
}

// Remove is two steps: asking opens the shared confirm dialog and nothing
// else; only confirming removes. Dismissing while the removal runs is ignored
// so the dialog cannot vanish mid-request.
export interface AvatarRemoveFlow {
  request: () => void
  confirm: () => Promise<void>
  dismiss: () => void
}
export function createAvatarRemoveFlow(deps: {
  closeViewer: () => void
  setConfirmOpen: (open: boolean) => void
  isWorking: () => boolean
  remove: () => Promise<void>
}): AvatarRemoveFlow {
  return {
    request: () => {
      deps.closeViewer()
      deps.setConfirmOpen(true)
    },
    confirm: () => deps.remove(),
    dismiss: () => {
      if (!deps.isWorking()) deps.setConfirmOpen(false)
    },
  }
}
