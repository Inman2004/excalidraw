import { createRoot } from "react-dom/client";

import { EditorFrame } from "./EditorFrame";
import "./editor.css";
import "./present.css";

createRoot(document.getElementById("root")!).render(<EditorFrame />);
