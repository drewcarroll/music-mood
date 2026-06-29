import React from 'react';
import ReactDOM from 'react-dom/client';

import { createContainer } from '@infrastructure/composition/container';
import { App } from '@interfaces/App';
import { UseCasesProvider } from '@interfaces/context/UseCasesContext';

/**
 * Application bootstrap (composition entry point).
 *
 * This file lives OUTSIDE the clean-architecture layer folders on purpose:
 * it is the single seam where infrastructure is constructed and injected
 * into the interfaces layer. The interfaces layer itself never imports
 * `@infrastructure/*` — it only consumes use cases through React context.
 *
 *   bootstrap  ->  infrastructure (build container)
 *   bootstrap  ->  interfaces     (render, inject use cases)
 */
const useCases = createContainer();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <UseCasesProvider useCases={useCases}>
      <App />
    </UseCasesProvider>
  </React.StrictMode>,
);
