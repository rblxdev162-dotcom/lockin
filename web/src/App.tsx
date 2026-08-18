import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useApp } from './store/context';
import { useTheme } from './hooks/useTheme';
import { useReminders } from './hooks/useReminders';
import { Shell } from './components/layout/Shell';
import { RouteErrorBoundary } from './components/layout/ErrorBoundary';
import { Toaster } from './components/ui/Toast';
import { Welcome } from './pages/Welcome';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { AssignmentsPage } from './pages/Assignments';
import { ExamsPage } from './pages/Exams';
import { FocusPage } from './pages/Focus';
import { PlannerPage } from './pages/Planner';
import { ActivityPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';
import { PrivacyPage } from './pages/Privacy';
import { HelpPage } from './pages/Help';
import { ParentPage } from './pages/Parent';

/** Keeps un-onboarded visitors on the welcome/onboarding flow. */
function Protected({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const location = useLocation();
  if (!state.profile) return <Navigate to="/" replace />;
  if (!state.profile.onboarded) return <Navigate to="/onboarding" replace />;
  return (
    <Shell key={location.pathname === '' ? 'root' : 'app'}>
      {/* Keyed on the path so a crash on one page does not persist onto the
          next: navigating away is itself a recovery. */}
      <RouteErrorBoundary key={location.pathname}>{children}</RouteErrorBoundary>
    </Shell>
  );
}

/** Parent View: no student shell, but still gated on having a profile. */
function ParentRoute() {
  const { state } = useApp();
  if (!state.profile?.onboarded) return <Navigate to="/" replace />;
  return <ParentPage />;
}

export default function App() {
  useTheme();
  useReminders();

  return (
    <>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          path="/home"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/assignments"
          element={
            <Protected>
              <AssignmentsPage />
            </Protected>
          }
        />
        <Route
          path="/exams"
          element={
            <Protected>
              <ExamsPage />
            </Protected>
          }
        />
        <Route
          path="/focus"
          element={
            <Protected>
              <FocusPage />
            </Protected>
          }
        />
        <Route
          path="/planner"
          element={
            <Protected>
              <PlannerPage />
            </Protected>
          }
        />
        <Route
          path="/activity"
          element={
            <Protected>
              <ActivityPage />
            </Protected>
          }
        />
        <Route
          path="/settings"
          element={
            <Protected>
              <SettingsPage />
            </Protected>
          }
        />
        <Route
          path="/help"
          element={
            <Protected>
              <HelpPage />
            </Protected>
          }
        />
        <Route
          path="/privacy"
          element={
            <Protected>
              <PrivacyPage />
            </Protected>
          }
        />
        {/* Parent View has its own chrome and its own PIN gate, so it sits
            outside <Protected>'s student shell — but it still requires a
            profile, because there is nothing to account for without one. */}
        <Route path="/parent" element={<ParentRoute />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
