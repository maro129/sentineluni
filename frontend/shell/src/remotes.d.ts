// Tipos de los módulos expuestos por los microfrontends remotos.
declare module 'incidents/IncidentsApp' {
  const C: React.ComponentType<import('@sentinel/shared').MfeProps>;
  export default C;
}
declare module 'notifications/NotificationsApp' {
  const C: React.ComponentType<import('@sentinel/shared').MfeProps>;
  export default C;
}
declare module 'audit/AuditKpis' {
  const C: React.ComponentType<import('@sentinel/shared').MfeProps>;
  export default C;
}
declare module 'audit/AuditLog' {
  const C: React.ComponentType<import('@sentinel/shared').MfeProps>;
  export default C;
}
