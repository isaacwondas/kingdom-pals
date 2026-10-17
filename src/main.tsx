
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./kingdom-connections.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found in index.html");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
