import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages can't set response headers, so the privacy-enforcing CSP is
 * injected as a <meta> tag at BUILD time only (in dev it would block Vite's
 * HMR websocket). Hosts that do support headers (Cloudflare) also get the
 * stronger header version from dist/_headers.
 *
 * connect-src stays 'self' unless VITE_CONTRIBUTE_URL is set at build time —
 * that origin is the only extra phone-home the browser is permitted, and the
 * app still only POSTs after an explicit Share click.
 * Note: frame-ancestors is header-only and therefore lives in _headers alone.
 */
function contributeConnectOrigin(): string {
  const raw = process.env.VITE_CONTRIBUTE_URL?.trim();
  if (!raw) return '';
  try {
    const origin = new URL(raw).origin;
    return origin.startsWith('https://') ? origin : '';
  } catch {
    return '';
  }
}

function connectSrc(): string {
  const extra = contributeConnectOrigin();
  return extra ? `connect-src 'self' ${extra}` : "connect-src 'self'";
}

function csp(): string {
  return (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    `img-src 'self' data:; ${connectSrc()}; worker-src 'self'; base-uri 'self'; form-action 'none'`
  );
}

function privacyCsp(): Plugin {
  return {
    name: 'privacy-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp()}" />`,
      );
    },
    closeBundle() {
      const headers = [
        '/*',
        `  Content-Security-Policy: ${csp()}; frame-ancestors 'none'`,
        '  X-Content-Type-Options: nosniff',
        '  Referrer-Policy: no-referrer',
        '',
      ].join('\n');
      writeFileSync(resolve('dist/_headers'), headers);
    },
  };
}

export default defineConfig({
  plugins: [react(), privacyCsp()],
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
