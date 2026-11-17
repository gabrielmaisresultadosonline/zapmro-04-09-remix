export type FlowDuplicateOwnership = {
  userId?: string | null;
  whatsapp_number_id?: string;
};

/** Monta uma cópia independente do fluxo sem alterar o objeto de origem. */
export function buildFlowDuplicate(
  source: any,
  ownership: FlowDuplicateOwnership,
  now = new Date(),
) {
  const nodeMap: Record<string, string> = {};
  const nodes = (source.nodes || []).map((node: any) => {
    const newId = `${node.type}_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
    nodeMap[node.id] = newId;
    return { ...node, id: newId };
  });
  const edges = (source.edges || []).map((edge: any) => ({
    ...edge,
    id: `e_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
    source: nodeMap[edge.source] || edge.source,
    target: nodeMap[edge.target] || edge.target,
  }));

  return {
    name: `${source.name} (Cópia)`,
    description: source.description ?? null,
    user_id: ownership.userId || undefined,
    trigger_type: source.trigger_type || "manual",
    trigger_keyword: source.trigger_keyword ?? null,
    trigger_keywords: source.trigger_keywords || [],
    trigger_tag: source.trigger_tag || null,
    is_active: false,
    nodes,
    edges,
    whatsapp_number_id: ownership.whatsapp_number_id,
    updated_at: now.toISOString(),
  };
}

/** Copia também os passos do modelo antigo, ainda usados por fluxos existentes. */
export function buildFlowStepDuplicates(
  sourceSteps: any[] | null | undefined,
  newFlowId: string,
  userId?: string | null,
  now = new Date(),
) {
  return (sourceSteps || []).map((step) => ({
    flow_id: newFlowId,
    step_order: step.step_order,
    message_text: step.message_text ?? null,
    buttons: step.buttons ?? null,
    delay_seconds: step.delay_seconds ?? 0,
    created_at: now.toISOString(),
    step_type: step.step_type || "text",
    media_url: step.media_url ?? null,
    media_type: step.media_type ?? null,
    user_id: userId || undefined,
  }));
}
