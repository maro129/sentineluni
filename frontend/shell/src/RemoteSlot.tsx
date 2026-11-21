import { Component, Suspense, type ComponentType, type ReactNode } from 'react';
import type { MfeProps } from '@sentinel/shared';

/** Si un microfrontend falla o no está desplegado, el resto del shell sigue funcionando. */
class Boundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <section className="panel mfe-down"><h2>{this.props.name}</h2><p className="muted">Microfrontend no disponible. El resto del sistema sigue operando.</p></section>;
    }
    return this.props.children;
  }
}

export function RemoteSlot({ name, Comp, props, className = '' }: { name: string; Comp: ComponentType<MfeProps>; props: MfeProps; className?: string }) {
  return (
    <div className={`slot ${className}`}>
      <Boundary name={name}>
        <Suspense fallback={<section className="panel"><p className="muted">Cargando {name}…</p></section>}>
          <Comp {...props} />
        </Suspense>
      </Boundary>
    </div>
  );
}
