import type { ReactNode } from 'react';

/** Camera viewing and robot tasks share the same workspace proportions. */
export function WorkspaceLayout({
  children,
  sidebar,
}: { children: ReactNode; sidebar: ReactNode }) {
  return (
    <main className="app-workspace">
      <section className="streams-section">{children}</section>
      <aside className="workstation-playground">
        <div className="task-panel">{sidebar}</div>
      </aside>
    </main>
  );
}
