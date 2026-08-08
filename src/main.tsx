import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.js";
import { RouteErrorBoundary } from "./ui/ErrorBoundary.js";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* Inside the router, so the fallback can link somewhere and so that
          navigating clears it. Shell has its own; this one only ever sees a
          throw in the frame itself. */}
      <RouteErrorBoundary>
        <App />
      </RouteErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
