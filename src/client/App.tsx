import { MantineProvider } from '@mantine/core';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './mantine';
import { cssVariablesResolver, theme } from './theme';
import { AppLayout } from './AppLayout';
import { FamilySpace } from './FamilySpace';
import { Pantry } from './Pantry';
import { RecipeDetail } from './RecipeDetail';
import { RecipeCreate, RecipeEdit } from './RecipeEditPages';
import { Recipes } from './Recipes';

/**
 * Sections are real routes so a link opens the right one and the device back
 * gesture moves between them — on a home-screen install it is the only back
 * affordance there is. The Worker serves the application shell for these
 * paths; see ADR 0007.
 */
export function App() {
  return (
    <MantineProvider
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="light"
      // Under the test runner Mantine skips floating-ui's detached-reference
      // hiding, which jsdom always triggers because it computes no layout.
      // Without this, menus and modals render but are invisible to role
      // queries — present in the DOM, absent from the accessibility tree.
      env={import.meta.env.MODE === 'test' ? 'test' : undefined}
      theme={theme}
    >
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />} path="/">
            <Route element={<Navigate replace to="/pantry" />} index />
            <Route element={<Pantry />} path="pantry" />
            <Route path="recipes">
              <Route element={<Recipes />} index />
              <Route element={<RecipeCreate />} path="new" />
              <Route element={<RecipeDetail />} path=":id" />
              <Route element={<RecipeEdit />} path=":id/edit" />
            </Route>
            <Route element={<FamilySpace />} path="family" />
            <Route element={<Navigate replace to="/pantry" />} path="*" />
          </Route>
        </Routes>
      </BrowserRouter>
    </MantineProvider>
  );
}
