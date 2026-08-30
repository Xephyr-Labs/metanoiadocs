/** One floating line at the bottom of the screen.
 *
 *  A menu closes the moment you pick something, so there is no component left
 *  to render feedback into — and an action that quietly failed is exactly the
 *  thing the user has to be told about.
 */

let host: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** An offer to reverse what just happened, shown inside the toast. */
export interface ToastAction {
  label: string;
  onSelect: () => void;
}

export function toast(message: string, action?: ToastAction): void {
  if (typeof document === 'undefined') return;
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    // Tooltip token: this floats over the page in both themes, the way the
    // app's tooltips do, so it stays dark in light mode and light-on-dark below.
    host.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'z-index:100', 'max-width:min(90vw,420px)',
      'padding:8px 12px', 'border-radius:6px',
      'background:var(--tooltip)', 'color:#fff',
      'font-family:var(--font-ui)', 'font-size:13px', 'line-height:19px',
      'box-shadow:0 8px 24px rgba(15,15,15,0.18)',
      'opacity:0', 'transition:opacity 120ms cubic-bezier(0.16,1,0.3,1)',
      'pointer-events:none',
    ].join(';');
    document.body.appendChild(host);
  }
  host.textContent = message;
  // Only a toast carrying an action can be clicked; a plain one must never
  // swallow a click meant for the page underneath it.
  host.style.pointerEvents = action ? 'auto' : 'none';
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.style.cssText = [
      'margin-left:12px', 'padding:0', 'border:0', 'background:none',
      'color:#fff', 'font:inherit', 'font-weight:600',
      'text-decoration:underline', 'cursor:pointer',
    ].join(';');
    button.addEventListener('click', () => {
      hide();
      action.onSelect();
    });
    host.appendChild(button);
  }
  // Next frame, so the transition runs on first show as well as on repeats.
  requestAnimationFrame(() => { if (host) host.style.opacity = '1'; });
  if (hideTimer) clearTimeout(hideTimer);
  // An action needs long enough to read the sentence and reach the button.
  hideTimer = setTimeout(hide, action ? 6000 : 2200);
}

function hide(): void {
  if (!host) return;
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
}
