/* ------------------------------------------------------------------
   Lightweight, privacy-conscious event tracking + ad-conversion layer.

   Every meaningful action calls track(). Events fan out to whatever is
   configured — Meta Pixel (so each becomes an ad-reportable conversion),
   PostHog (real product dashboards), and a GTM/GA dataLayer — and are
   ALWAYS mirrored to window.__gwEvents so the funnel is inspectable even
   with nothing configured.

   FORKERS: set these via Vite env (.env.local) to activate:
     VITE_META_PIXEL_ID   e.g. 1234567890123456
     VITE_POSTHOG_KEY     e.g. phc_xxx
     VITE_POSTHOG_HOST    default https://us.i.posthog.com
   Nothing is sent until at least one is set.
   ------------------------------------------------------------------ */

const env = (import.meta as any).env || {};
const META_PIXEL_ID: string | null = env.VITE_META_PIXEL_ID || null;
const POSTHOG_KEY: string | null = env.VITE_POSTHOG_KEY || null;
const POSTHOG_HOST: string = env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

/* Meta standard events optimize better than custom ones — map our key
   conversions onto the closest standard name, and always also send the
   descriptive custom event. */
const META_STANDARD: Record<string, string> = {
  newsletter_subscribe: "Lead",
  letter_generated: "Contact",
  civic_click: "Contact",
  impact_report_run: "ViewContent",
  dataset_download: "Download",
};

type Props = Record<string, unknown>;
const w = window as any;
w.__gwEvents = w.__gwEvents || [];

/** Run a vendor snippet in page scope via an injected <script> so we don't
    have to type-check minified loader code. */
function inject(code: string) {
  const s = document.createElement("script");
  s.text = code;
  document.head.appendChild(s);
}

function loadMetaPixel(id: string) {
  if (w.fbq) return;
  inject(
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
    `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init','${id}');fbq('track','PageView');`
  );
}

function loadPostHog(key: string, host: string) {
  if (w.posthog) return;
  inject(
    `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){` +
    `function g(t,e){var o=e.split('.');2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){` +
    `t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement('script'))` +
    `.type='text/javascript',p.async=!0,p.src=s.api_host+'/static/array.js',(r=t.getElementsByTagName` +
    `('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',` +
    `u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),` +
    `t||(e+=' (stub)'),e},u.people.toString=function(){return u.toString(1)+'.people (stub)'},` +
    `o='init capture register register_once register_for_session unregister unregister_for_session ` +
    `getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags identify setPersonProperties ` +
    `group resetGroups reset get_distinct_id getGroups get_session_id alias set_config opt_in_capturing ` +
    `opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'` +
    `.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);` +
    `posthog.init('${key}',{api_host:'${host}',capture_pageview:true,persistence:'localStorage+cookie'});`
  );
}

/** Boot whatever analytics providers are configured. Safe no-op otherwise. */
export function initAnalytics() {
  try {
    if (META_PIXEL_ID) loadMetaPixel(META_PIXEL_ID);
    if (POSTHOG_KEY) loadPostHog(POSTHOG_KEY, POSTHOG_HOST);
  } catch { /* never let analytics break the app */ }
  track("app_open", { path: location.pathname });
}

/** Record an event. Fans out to every configured sink; always inspectable. */
export function track(event: string, props: Props = {}) {
  try {
    w.__gwEvents.push({ event, props, t: Date.now() });
    if (w.__gwEvents.length > 500) w.__gwEvents.shift();
    w.posthog?.capture?.(event, props);
    if (w.fbq) {
      const std = META_STANDARD[event];
      if (std) w.fbq("track", std, props);
      w.fbq("trackCustom", event, props);
    }
    (w.dataLayer = w.dataLayer || []).push({ event, ...props });
    if (env.DEV) console.debug("[track]", event, props);
  } catch { /* swallow */ }
}
