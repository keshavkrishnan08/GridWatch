/* ------------------------------------------------------------------
   GridWatch Signal — newsletter capture.

   Top "broadcast" popup + an embeddable signup used inside Take Action.
   Static-friendly: set NEWSLETTER_ENDPOINT to your provider's form-POST
   URL (Buttondown / Substack / Mailchimp / Formspree all expose one) and
   sign-ups go straight there via a hidden iframe — no backend, no CORS.
   Until it's set, addresses are kept in localStorage so a fork can export
   them, and the visitor still gets an honest confirmation.
   ------------------------------------------------------------------ */

import { track } from "./track";

const KEY_STATE = "gw-news";     // "sub" | "closed"
const KEY_EMAILS = "gw-news-emails";
const SINK = "gw-news-sink";     // hidden iframe target for the no-CORS POST

// ↓↓↓ FORKERS: drop your provider's embed/POST endpoint here to go live. ↓↓↓
const NEWSLETTER_ENDPOINT: string | null = null;
// e.g. "https://buttondown.com/api/emails/embed-subscribe/gridwatch-indiana"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function remember(email: string) {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY_EMAILS) || "[]");
    if (Array.isArray(prev) && !prev.includes(email)) {
      prev.push(email);
      localStorage.setItem(KEY_EMAILS, JSON.stringify(prev));
    }
  } catch { /* storage may be blocked — fail quietly */ }
}

function postToProvider(email: string) {
  if (!NEWSLETTER_ENDPOINT) return;
  let sink = document.querySelector<HTMLIFrameElement>(`iframe[name="${SINK}"]`);
  if (!sink) {
    sink = document.createElement("iframe");
    sink.name = SINK;
    sink.style.display = "none";
    document.body.appendChild(sink);
  }
  const form = document.createElement("form");
  form.action = NEWSLETTER_ENDPOINT;
  form.method = "post";
  form.target = SINK;
  const field = document.createElement("input");
  field.type = "email";
  field.name = "email";
  field.value = email;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/** The signup form markup. `compact` trims copy for the top popup. */
export function newsletterFormHTML(compact = false): string {
  return `
    <form class="nl-form" novalidate>
      <div class="nl-input-row">
        <input class="nl-email" type="email" name="email" required
               autocomplete="email" placeholder="you@email.com"
               aria-label="Your email address" />
        <button class="nl-submit" type="submit">SUBSCRIBE</button>
      </div>
      <div class="nl-msg" role="status" aria-live="polite"></div>
      <div class="nl-fine">${compact
        ? "Free · a short brief when Indiana's grid numbers move · unsubscribe anytime"
        : "Free. A short brief when a new docket lands, a hearing is set, or a proposal moves. Unsubscribe in one click."}</div>
    </form>`;
}

/** Wire a signup form inside `scope`. Calls `onDone` after a successful sub. */
export function wireNewsletterForm(scope: HTMLElement, onDone?: () => void) {
  const form = scope.querySelector<HTMLFormElement>(".nl-form");
  if (!form) return;
  const email = form.querySelector<HTMLInputElement>(".nl-email")!;
  const msg = form.querySelector<HTMLElement>(".nl-msg")!;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = email.value.trim();
    if (!EMAIL_RE.test(val)) {
      msg.textContent = "That email doesn't look right — mind checking it?";
      msg.className = "nl-msg err";
      email.focus();
      return;
    }
    remember(val);
    postToProvider(val);
    track("newsletter_subscribe", { where: scope.id || "embed" });
    localStorage.setItem(KEY_STATE, "sub");
    form.classList.add("done");
    msg.innerHTML = `<span class="nl-ok">✓ You're on the list.</span> Watch for the first GridWatch brief.`;
    msg.className = "nl-msg ok";
    onDone?.();
  });
}

export class Newsletter {
  private root: HTMLElement;
  constructor(root: HTMLElement) { this.root = root; }

  /** Auto-show once, unless the visitor already subscribed or closed it. */
  maybeShow(delayMs = 2600) {
    const st = localStorage.getItem(KEY_STATE);
    if (st === "sub" || st === "closed") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) delayMs = 400;
    window.setTimeout(() => { if (localStorage.getItem(KEY_STATE) == null) this.open(); }, delayMs);
  }

  open() {
    if (this.root.classList.contains("on")) return;
    this.root.hidden = false;
    this.root.innerHTML = `
      <div class="nl-pop panel bracket" role="dialog" aria-label="Subscribe to the GridWatch Signal">
        <button class="nl-close" aria-label="Dismiss">✕</button>
        <div class="nl-eyebrow">◈ GRIDWATCH SIGNAL</div>
        <div class="nl-head">The grid is changing faster than the filings.</div>
        <div class="nl-sub">Indiana's data-center load is climbing by the month. Get a short, sourced brief when the numbers move — new dockets, hearings, and proposals.</div>
        ${newsletterFormHTML(true)}
      </div>`;
    this.root.querySelector(".nl-close")!.addEventListener("click", () => this.close(true));
    wireNewsletterForm(this.root, () => window.setTimeout(() => this.close(false), 2100));
    requestAnimationFrame(() => this.root.classList.add("on"));
  }

  close(persist: boolean) {
    if (persist && localStorage.getItem(KEY_STATE) == null) localStorage.setItem(KEY_STATE, "closed");
    this.root.classList.remove("on");
    window.setTimeout(() => { this.root.hidden = true; this.root.innerHTML = ""; }, 320);
  }
}
