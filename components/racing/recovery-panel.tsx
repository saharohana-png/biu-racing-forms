import type { ReactNode } from 'react';

export function RecoveryPanel({ code, title, children, actions }: {
  code: string;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return <main className="command-mode recovery-page" id="main">
    <section className="recovery-panel" aria-labelledby="recovery-title">
      <a className="recovery-brand" href="/" aria-label="BIU Racing, חזרה ללוח המערכות">
        <img src="/brand/biu-racing.png" alt="BIU Racing" width="88" height="88" />
      </a>
      <p className="recovery-code"><bdi>{code}</bdi></p>
      <h1 id="recovery-title">{title}</h1>
      <div>{children}</div>
      <div className="recovery-actions">{actions}</div>
    </section>
  </main>;
}
