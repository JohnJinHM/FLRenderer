import type { ReactNode } from 'react';
import './Layout.css';

interface LayoutProps {
  header: ReactNode;
  sidebar: ReactNode;
  canvas: ReactNode;
  timeline: ReactNode;
}

export function Layout({ header, sidebar, canvas, timeline }: LayoutProps) {
  return (
    <div className="layout">
      <header className="layout__header">{header}</header>
      <div className="layout__body">
        <div className="layout__sidebar">{sidebar}</div>
        <main className="layout__canvas">{canvas}</main>
      </div>
      <div className="layout__timeline">{timeline}</div>
    </div>
  );
}
