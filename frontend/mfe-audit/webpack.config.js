// MICROFRONTEND "audit": se despliega por separado y el shell lo carga en tiempo de ejecución
// desde /mfe/audit/remoteEntry.js (Module Federation).
const makeConfig = require('../webpack.common');

module.exports = makeConfig({
  dir: __dirname,
  name: 'audit',
  port: 4003,
  exposes: { './AuditKpis': './src/AuditKpis.tsx', './AuditLog': './src/AuditLog.tsx' },
});
