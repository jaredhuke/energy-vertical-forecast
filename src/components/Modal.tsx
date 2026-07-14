import { useEffect, useRef, type ReactNode } from 'react'

/** Lightweight accessible modal: Escape + backdrop-click to close, body scroll
 *  locked while open, keyboard focus moved in on open, trapped while open, and
 *  restored to the invoking element on close. The child provides its own card. */
export function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Move focus into the dialog (the shell itself, so Escape works instantly).
    shellRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && shellRef.current) {
        // Keep Tab cycling inside the dialog.
        const focusables = shellRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === shellRef.current)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-shell" role="dialog" aria-modal="true" tabIndex={-1} ref={shellRef}>
        {children}
      </div>
    </div>
  )
}
