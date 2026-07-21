import { AppProviders } from './app/app-providers';
import { AppRouter } from './app/app-router';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
