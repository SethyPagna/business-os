// ?? Modal ??????????????????????????????????????????????????????????????????????
// Generic overlay modal used across Branches, Contacts, Products, and Users.
// The `wide` prop expands the modal to max-w-4xl (default: max-w-2xl).
// The `size` prop allows more fine-grained control: 'sm' | 'md' | 'lg' | 'xl'
// When neither `wide` nor `size` is passed, behaves as max-w-2xl.

/**
 * @param {{ title: string, onClose: () => void, children: React.ReactNode, wide?: boolean, size?: 'sm'|'md'|'lg'|'xl' }} props
 */
export default function Modal({ title, onClose, children, wide, size }) {
  const widthClass =
    size === 'sm' ? 'max-w-lg' :
    size === 'lg' ? 'max-w-3xl' :
    size === 'xl' ? 'max-w-4xl' :
    wide          ? 'max-w-4xl' :
    'max-w-2xl'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${widthClass} max-h-[92vh] flex flex-col fade-in`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >×</button>
        </div>
        <div className="modal-scroll p-5">{children}</div>
      </div>
    </div>
  )
}

