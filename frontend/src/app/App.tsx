import { Providers } from './providers';
import { AppRouter } from './router';
import '../styles/index.css';

export function App() {
  return (
    <Providers>
      <AppRouter />
    </Providers>
  );
}
