import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./ui";

const requestedView = new URLSearchParams(window.location.search).get("view");
if (requestedView === "companion" || requestedView === "overlay" || requestedView === "settings") {
  document.documentElement.dataset.view = requestedView;
}

const root = document.getElementById("root");
if (!root) throw new Error("PATCH renderer root is missing.");
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
