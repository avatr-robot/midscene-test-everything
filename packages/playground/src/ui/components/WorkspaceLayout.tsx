import type { ReactNode } from 'react';

/** Camera viewing and robot tasks share the same workspace proportions. */
export function WorkspaceLayout({
  children,
  sidebar,
  sidebarBusy = false,
}: { children: ReactNode; sidebar: ReactNode; sidebarBusy?: boolean }) {
  return (
    <main className="app-workspace">
      <section className="streams-section">{children}</section>
      <aside className="workstation-playground">
        <div
          className="task-panel"
          aria-busy={sidebarBusy}
          {...(sidebarBusy ? { inert: '' } : {})}
        >
          {sidebar}
        </div>
      </aside>
    </main>
  );
}
