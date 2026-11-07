import { createRoot } from 'react-dom/client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/app.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

// StrictMode is intentionally off: it double-mounts effects, which makes
// MapLibre controls (MapboxOverlay) register twice and breaks interleaved
// rendering in development. Re-enable once the overlay is StrictMode-safe.
createRoot(container).render(<App />);
