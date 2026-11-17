// Safety net for an iOS bug: after the keyboard closes, iOS sometimes leaves the page
// shifted, which made the fixed tab bar float mid-screen. When focus leaves a text field
// and doesn't land in another one, nudge the page so iOS re-measures the viewport.

const isField = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')

export function installKeyboardReset() {
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (isField(document.activeElement)) return
      // Re-apply the current scroll position: forces iOS to recompute fixed elements
      // without moving the page for the user.
      window.scrollTo(window.scrollX, window.scrollY)
    }, 100)
  })
}
