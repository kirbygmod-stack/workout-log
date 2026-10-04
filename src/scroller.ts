// The page itself never scrolls. All screen content scrolls inside `.scroller`,
// so iOS can't leave the page at a stale scroll offset (which made the fixed
// tab bar float mid-screen after the keyboard closed).

export function getScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.scroller')
}

export function scrollToTop(smooth = false) {
  getScroller()?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
}

/** Lock scrolling of the content area (used while a bottom sheet is open). Returns an unlock function. */
export function lockScroll(): () => void {
  const el = getScroller()
  if (!el) return () => {}
  const prev = el.style.overflowY
  el.style.overflowY = 'hidden'
  return () => {
    el.style.overflowY = prev
  }
}

/**
 * Safety net: after the iOS keyboard closes, iOS sometimes leaves the page shifted.
 * When focus leaves a text field and doesn't land in another one, put the page back.
 */
export function installKeyboardReset() {
  const isField = (el: Element | null) =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!isField(document.activeElement) && (window.scrollY !== 0 || window.scrollX !== 0)) {
        window.scrollTo(0, 0)
      }
    }, 50)
  })
}
