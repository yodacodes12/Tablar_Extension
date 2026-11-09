import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/styles.css';
import { DashboardApp } from '../../components/dashboard';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardApp defaultSection="settings" />
  </StrictMode>,
);
