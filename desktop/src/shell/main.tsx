import { createRoot } from "react-dom/client";

import { Shell } from "./Shell";
import "./shell.css";
import "./panels.css";

createRoot(document.getElementById("root")!).render(<Shell />);
