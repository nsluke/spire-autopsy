import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages can't set response headers, so the privacy-enforcing CSP is
 * injected as a <meta> tag at BUILD time only (in dev it would block Vite's
 * HMR websocket). Hosts that do support headers (Cloudflare) also get the
 * stronger header version from public/_headers — the two are equivalent for
 * the "cannot phone home" guarantee (connect-src 'self').
 * Note: frame-ancestors is header-only and therefore lives in _headers alone.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'none'";

function buildTimeCsp(): Plugin {
  return {
    name: 'build-time-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildTimeCsp()],
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
