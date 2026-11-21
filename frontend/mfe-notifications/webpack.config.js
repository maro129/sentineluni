// MICROFRONTEND "notifications": se despliega por separado y el shell lo carga en tiempo de ejecución
// desde /mfe/notifications/remoteEntry.js (Module Federation).
const makeConfig = require('../webpack.common');

module.exports = makeConfig({
  dir: __dirname,
  name: 'notifications',
  port: 4002,
  exposes: { './NotificationsApp': './src/NotificationsApp.tsx' },
});
