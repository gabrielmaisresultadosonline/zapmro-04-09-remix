import { createRoot } from "react-dom/client";
import "./index.css";
import ConversationRulesGuide from "@/components/crm/ConversationRulesGuide";

/** Prévia temporária: apenas para conferir visualmente o guia de regras. */
const root = document.getElementById("root");
if (root) createRoot(root).render(<ConversationRulesGuide />);
