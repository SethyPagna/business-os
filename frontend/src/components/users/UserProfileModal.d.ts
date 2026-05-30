import type { ReactElement } from 'react'

export interface UserProfileModalProps {
  onClose: () => void
}

export default function UserProfileModal(props: UserProfileModalProps): ReactElement | null
