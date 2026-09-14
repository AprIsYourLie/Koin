import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import KoinApp from "./KoinApp";
import "./globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Koin 无法找到应用入口");

createRoot(root).render(
  <StrictMode>
    <KoinApp />
  </StrictMode>,
);

