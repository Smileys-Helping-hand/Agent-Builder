import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { site } from "./content";
import "./styles/base.css";
import "./styles/template.css";

document.title = site.business.name;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
