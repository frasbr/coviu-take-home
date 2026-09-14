import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { SERVER_URL } from "./config.js";
import "./index.css";

const container = document.querySelector<HTMLDivElement>("#app");
if (!container) {
  throw new Error("#app element not found");
}

createRoot(container).render(
  <StrictMode>
    <App baseUrl={SERVER_URL} pathname={window.location.pathname} />
  </StrictMode>,
);
