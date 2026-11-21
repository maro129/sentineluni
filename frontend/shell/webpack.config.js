// SHELL (host): carga los microfrontends en tiempo de ejecución con Module Federation
// y es la PWA instalable (manifest + service worker generado con Workbox).
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { GenerateSW } = require('workbox-webpack-plugin');
const makeConfig = require('../webpack.common');

const api = process.env.API_URL || 'https://localhost';
const mfe = (name, port) => ({
  context: [`/mfe/${name}`], target: `http://localhost:${port}`, pathRewrite: { [`^/mfe/${name}`]: '' },
});

module.exports = makeConfig({
  dir: __dirname,
  name: 'shell',
  port: 4000,
  publicPath: '/',
  // Los remotes se resuelven por URL relativa: en producción el API Gateway (Traefik)
  // sirve cada microfrontend bajo /mfe/<nombre>/ desde su propio contenedor.
  remotes: {
    incidents: 'incidents@/mfe/incidents/remoteEntry.js',
    notifications: 'notifications@/mfe/notifications/remoteEntry.js',
    audit: 'audit@/mfe/audit/remoteEntry.js',
  },
  devServer: {
    proxy: [
      mfe('incidents', 4001), mfe('notifications', 4002), mfe('audit', 4003),
      { context: ['/api'], target: api, secure: false, changeOrigin: true },
    ],
  },
  plugins: (prod) => [
    new CopyWebpackPlugin({ patterns: [{ from: path.join(__dirname, 'public'), globOptions: { ignore: ['**/index.html'] } }] }),
    ...(prod
      ? [new GenerateSW({
          swDest: 'sw.js',
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/mfe\//],
          exclude: [/\.map$/],
          runtimeCaching: [
            // remoteEntry siempre fresco (NetworkFirst); el resto de chunks de los MFE con caché
            { urlPattern: ({ url }) => url.pathname.startsWith('/mfe/') && url.pathname.endsWith('remoteEntry.js'), handler: 'NetworkFirst', options: { cacheName: 'mfe-entries' } },
            { urlPattern: ({ url }) => url.pathname.startsWith('/mfe/'), handler: 'StaleWhileRevalidate', options: { cacheName: 'mfe-chunks' } },
            // /api nunca se cachea: contiene datos protegidos por JWT
          ],
        })]
      : []),
  ],
});
