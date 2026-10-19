import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { configureAmplify } from './amplifyConfigure';
import { App } from './App';

configureAmplify();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
