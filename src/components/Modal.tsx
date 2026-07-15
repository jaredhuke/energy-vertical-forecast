import { useEffect, useRef, type ReactNode } from 'react'

/** Lightweight accessible modal: Escape + backdrop-click to close, body scroll
 *  locked while open, keyboard focus moved into the first field on open,
 *  trapped while open, and restored to the invoking element on close. */
export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  const shellRef = useRef<HTMLDivElement>(null)
  // Keep a live ref to onClose so the key handler never needs it as a dep
  // (a changing onClose must NOT re-run the focus effect — that steals focus
  // from whatever field you're typing in on every keystroke).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus management + scroll lock — MOUNT/UNMOUNT ONLY.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const shell = shellRef.current
    // Land focus on the first editable field so you can type immediately.
    const firstField = shell?.querySelector<HTMLElement>('input, select, textarea')
    ;(firstField ?? shell)?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && shellRef.current) {
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
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal-shell${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={shellRef}>
        {children}
      </div>
    </div>
  )
}
