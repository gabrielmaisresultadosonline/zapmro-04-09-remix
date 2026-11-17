import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckSquare, Copy, Loader2, RefreshCw, Workflow } from "lucide-react";
import { toast } from "sonner";
import { adminCall, adminErrorMessage, adminRead, type AdminCreds } from "@/lib/adminCentralApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FlowItem = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  archived_from_label?: string | null;
};

type FlowSource = {
  key: string;
  userId: string;
  accountLabel: string;
  numberLabel: string;
  connected: boolean;
  flows: FlowItem[];
};

type FlowTarget = {
  id: string;
  userId: string;
  accountLabel: string;
  numberLabel: string;
};

type Catalog = { sources: FlowSource[]; targets: FlowTarget[] };

export default function FlowCopyAdminPanel({ creds }: { creds: AdminCreds | null }) {
  const [catalog, setCatalog] = useState<Catalog>({ sources: [], targets: [] });
  const [sourceKey, setSourceKey] = useState("");
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);

  const load = async () => {
    if (!creds) return;
    setLoading(true);
    try {
      const data = await adminRead<Catalog>("list_flow_copy_catalog", creds, {}, { timeoutMs: 60000 });
      const next = { sources: data.sources || [], targets: data.targets || [] };
      setCatalog(next);
      setSourceKey((current) => {
        if (next.sources.some((source) => source.key === current)) return current;
        return next.sources.find((source) => source.flows.length > 0)?.key || next.sources[0]?.key || "";
      });
      setTargetId((current) => next.targets.some((target) => target.id === current) ? current : next.targets[0]?.id || "");
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível carregar os fluxos"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [creds]);

  const source = catalog.sources.find((item) => item.key === sourceKey);
  const targets = catalog.targets.filter((target) => target.id !== sourceKey);
  const target = catalog.targets.find((item) => item.id === targetId);
  const visibleFlows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return (source?.flows || []).filter((flow) => !query || flow.name.toLocaleLowerCase("pt-BR").includes(query));
  }, [source, search]);
  const allVisibleSelected = visibleFlows.length > 0 && visibleFlows.every((flow) => selected.has(flow.id));

  useEffect(() => {
    setSelected(new Set());
    setSearch("");
    if (targetId === sourceKey) setTargetId(catalog.targets.find((item) => item.id !== sourceKey)?.id || "");
  }, [sourceKey]);

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleFlows.forEach((flow) => next.delete(flow.id));
      else visibleFlows.forEach((flow) => next.add(flow.id));
      return next;
    });
  };

  const copy = async () => {
    if (!creds || !source || !target || selected.size === 0 || copying) return;
    if (!confirm(`Copiar ${selected.size} fluxo(s) de ${source.numberLabel} para ${target.numberLabel}?\n\nA origem será preservada e as cópias chegarão desligadas.`)) return;
    setCopying(true);
    try {
      const data = await adminCall<{ copied?: number }>("copy_flows_between_numbers", creds, {
        flowIds: Array.from(selected),
        targetNumberId: target.id,
      }, { timeoutMs: 60000 });
      toast.success(`${Number(data.copied || selected.size)} fluxo(s) copiado(s), desligados e prontos para revisar no destino.`);
      setSelected(new Set());
      await load();
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível copiar os fluxos"));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Workflow className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-semibold">Copiar fluxos entre números</h2>
              <p className="text-sm text-muted-foreground">Escolha fluxos de qualquer cadastro e copie para outro WhatsApp, sem alterar a origem.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading || copying}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar lista
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
        <div className="space-y-2">
          <Label>Número de origem</Label>
          <Select value={sourceKey} onValueChange={setSourceKey} disabled={loading || copying}>
            <SelectTrigger><SelectValue placeholder="Escolha a origem" /></SelectTrigger>
            <SelectContent>
              {catalog.sources.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.accountLabel} · {item.numberLabel} ({item.flows.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground lg:block" />
        <div className="space-y-2">
          <Label>Número de destino</Label>
          <Select value={targetId} onValueChange={setTargetId} disabled={loading || copying || targets.length === 0}>
            <SelectTrigger><SelectValue placeholder="Escolha o destino" /></SelectTrigger>
            <SelectContent>
              {targets.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.accountLabel} · {item.numberLabel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <h3 className="font-semibold">Fluxos da origem</h3>
            <p className="text-xs text-muted-foreground">{selected.size} selecionado(s) · as cópias sempre chegam desligadas</p>
          </div>
          <Button variant="outline" size="sm" onClick={toggleAll} disabled={visibleFlows.length === 0 || copying}>
            <CheckSquare className="mr-2 h-4 w-4" />{allVisibleSelected ? "Desmarcar visíveis" : "Selecionar visíveis"}
          </Button>
        </div>
        <div className="border-b p-4">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar fluxo pelo nome..." disabled={loading || copying} />
        </div>
        <div className="max-h-[460px] overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando fluxos...</div>
          ) : visibleFlows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{source?.flows.length ? "Nenhum fluxo encontrado nesta busca." : "Este número ainda não tem fluxos para copiar."}</p>
          ) : visibleFlows.map((flow) => (
            <label key={flow.id} className="flex cursor-pointer items-center gap-3 rounded-md p-3 hover:bg-muted/60">
              <Checkbox
                checked={selected.has(flow.id)}
                disabled={copying}
                onCheckedChange={(checked) => setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(flow.id); else next.delete(flow.id);
                  return next;
                })}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{flow.name}</span>
                <span className="text-xs text-muted-foreground">Criado em {new Date(flow.created_at).toLocaleDateString("pt-BR")}</span>
              </span>
              <Badge variant={flow.is_active ? "default" : "secondary"}>{flow.is_active ? "Ativo" : "Desligado"}</Badge>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/30 p-4">
          <p className="max-w-2xl text-xs text-muted-foreground">Textos, mídias e configurações dos blocos vão junto. Arquivos do Agente usados por código precisam existir no cadastro de destino.</p>
          <Button onClick={copy} disabled={!source || !target || selected.size === 0 || copying || loading}>
            {copying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
            {copying ? "Copiando..." : `Copiar ${selected.size || ""} fluxo(s)`}
          </Button>
        </div>
      </Card>
      {!loading && catalog.targets.length === 0 && <p className="text-center text-sm text-destructive">Nenhum WhatsApp conectado disponível como destino.</p>}
    </div>
  );
}
