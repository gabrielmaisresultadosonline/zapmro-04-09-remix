import { describe, expect, it } from "bun:test";
import { buildFlowDuplicate, buildFlowStepDuplicates } from "../../../src/lib/flowDuplication";

const source = {
  id: "flow-original",
  name: "Entrega",
  description: "Entrega após confirmação",
  is_active: true,
  trigger_type: "exact_phrase",
  trigger_keyword: "comprar",
  trigger_keywords: ["comprar"],
  trigger_tag: "vendas",
  nodes: [
    { id: "message_1", type: "message", data: { text: "Olá" } },
    { id: "delay_1", type: "delay", data: { delay: 120 } },
  ],
  edges: [{ id: "edge_1", source: "message_1", target: "delay_1" }],
  crm_flow_steps: [{
    id: "step-original",
    flow_id: "flow-original",
    step_order: 1,
    message_text: "Áudio de boas-vindas",
    buttons: [{ text: "Continuar" }],
    delay_seconds: 120,
    step_type: "audio",
    media_url: "https://exemplo.test/audio.mp3",
    media_type: "audio/mpeg",
    user_id: "user-1",
  }],
};

describe("duplicação de fluxo no CRM", () => {
  it("preserva a origem e copia descrição, gatilhos, blocos, conexões e passos", () => {
    const before = JSON.stringify(source);
    const now = new Date("2026-11-17T00:00:00.000Z");
    const duplicate = buildFlowDuplicate(source, { userId: "user-1", whatsapp_number_id: "number-1" }, now);
    const steps = buildFlowStepDuplicates(source.crm_flow_steps, "flow-copy", "user-1", now);

    expect(JSON.stringify(source)).toBe(before);
    expect(duplicate.description).toBe("Entrega após confirmação");
    expect(duplicate.trigger_keyword).toBe("comprar");
    expect(duplicate.nodes.map((node: any) => node.id)).not.toEqual(["message_1", "delay_1"]);
    expect(duplicate.edges[0].source).toBe(duplicate.nodes[0].id);
    expect(duplicate.edges[0].target).toBe(duplicate.nodes[1].id);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      flow_id: "flow-copy",
      step_order: 1,
      message_text: "Áudio de boas-vindas",
      delay_seconds: 120,
      step_type: "audio",
      media_url: "https://exemplo.test/audio.mp3",
      media_type: "audio/mpeg",
      user_id: "user-1",
    });
  });

  it("cria a cópia desligada e pertencente ao número aberto", () => {
    const duplicate = buildFlowDuplicate(source, { userId: "user-1", whatsapp_number_id: "number-1" });
    expect(duplicate.name).toBe("Entrega (Cópia)");
    expect(duplicate.is_active).toBe(false);
    expect(duplicate.user_id).toBe("user-1");
    expect(duplicate.whatsapp_number_id).toBe("number-1");
  });
});
