/**
 * A stand-in for the parts of `<dialog>` jsdom does not implement.
 *
 * jsdom 30 exposes `HTMLDialogElement` but none of `show()`, `showModal()` or
 * `close()`, so a component built on the native element throws on mount. This is the
 * same category of shim as the `IntersectionObserver` and `EventSource` stubs in
 * `setup.ts`: it stands in for a browser API, and it stubs no application code.
 *
 * Deliberately not a full implementation. There is no top layer in jsdom, so the modal
 * focus trap and inertness of the rest of the page are the `Dialog` component's own
 * keyboard handling — which is why that behaviour is asserted by a test instead of
 * being assumed from the platform.
 */
export const installDialogStub = (): void => {
  const proto = window.HTMLDialogElement.prototype
  if (typeof proto.showModal === 'function') return

  if (Object.getOwnPropertyDescriptor(proto, 'open') === undefined) {
    Object.defineProperty(proto, 'open', {
      configurable: true,
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open')
      },
      set(this: HTMLDialogElement, value: boolean) {
        if (value) this.setAttribute('open', '')
        else this.removeAttribute('open')
      },
    })
  }

  proto.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }

  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }

  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return
    if (returnValue !== undefined) this.returnValue = returnValue
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
