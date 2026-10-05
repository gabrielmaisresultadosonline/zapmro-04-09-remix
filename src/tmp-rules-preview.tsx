import { createRoot } from "react-dom/client";
import "./index.css";
import ConversationPricingGuide from "@/components/crm/ConversationPricingGuide";

/** Prévia temporária: apenas para conferir visualmente a seção de cobrança. */
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <div className="min-h-screen bg-background p-6">
      <ConversationPricingGuide />
    </div>,
  );
