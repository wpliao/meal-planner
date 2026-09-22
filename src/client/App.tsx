import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import { FamilySpace } from './FamilySpace';
import { Pantry } from './Pantry';

/**
 * Sections are real routes so a link opens the right one and the device back
 * gesture moves between them — on a home-screen install it is the only back
 * affordance there is. The Worker serves the application shell for these
 * paths; see ADR 0007.
 */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />} path="/">
          <Route element={<Navigate replace to="/pantry" />} index />
          <Route element={<Pantry />} path="pantry" />
          <Route element={<FamilySpace />} path="family" />
          <Route element={<Navigate replace to="/pantry" />} path="*" />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
