// MICROFRONTEND "incidents": se despliega por separado y el shell lo carga en tiempo de ejecución
// desde /mfe/incidents/remoteEntry.js (Module Federation).
const makeConfig = require('../webpack.common');

module.exports = makeConfig({
  dir: __dirname,
  name: 'incidents',
  port: 4001,
  exposes: { './IncidentsApp': './src/IncidentsApp.tsx' },
});
