import { Navigate, Route, Routes } from 'react-router';

import { AppLayout } from '../components/layout/AppLayout';
import { IncidentDetailsPage } from '../features/incidents/IncidentDetailsPage';
import { IncidentCenterPage } from '../features/incidents/IncidentCenterPage';
import { OverviewPage } from '../features/overview/OverviewPage';

export function AppRouter() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/incidents" element={<IncidentCenterPage />} />
        <Route path="/incidents/:incidentId" element={<IncidentDetailsPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
