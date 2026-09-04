import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  acessorDb, daysLeft, formatCurrency, formatDateTime, onlyDigits,
  type AcessorAppointment, type AcessorEntry, type AcessorNumber, type AcessorProfile,
} from "@/lib/acessorApi";
import { Loader2, LogOut, Plus, Power } from "lucide-react";

/** Painel do cliente do Acessor (rota /acessor/dashboard). */
const AcessorDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<AcessorProfile | null>(null);
  const [numbers, setNumbers] = useState<AcessorNumber[]>([]);
  const [entries, setEntries] = useState<AcessorEntry[]>([]);
  const [appointments, setAppointments] = useState<AcessorAppointment[]>([]);
  const [newPhone, setNewPhone] = useState("");

  const load = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session.session?.user?.id;
    if (!userId) {
      navigate("/acessor/login", { replace: true });
      return;
    }

    const [profileRes, numbersRes, entriesRes, apptRes] = await Promise.all([
      acessorDb.from("acessor_profiles").select("*").eq("id", userId).maybeSingle(),
      acessorDb.from("acessor_numbers").select("*").eq("user_id", userId).order("created_at"),
      acessorDb.from("acessor_entries").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(200),
      acessorDb.from("acessor_appointments").select("*").eq("user_id", userId).order("starts_at").limit(100),
    ]);

    setProfile((profileRes.data as AcessorProfile) ?? null);
    setNumbers((numbersRes.data as AcessorNumber[]) ?? []);
    setEntries((entriesRes.data as AcessorEntry[]) ?? []);
    setAppointments((apptRes.data as AcessorAppointment[]) ?? []);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  // Recarrega em tempo real quando o agente grava algo pelo WhatsApp.
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel(`acessor-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "acessor_entries", filter: `user_id=eq.${profile.id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "acessor_appointments", filter: `user_id=eq.${profile.id}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profile?.id, load]);

  const totals = useMemo(() => {
    const sum = (kind: AcessorEntry["kind"]) =>
      entries.filter((e) => e.kind === kind).reduce((acc, e) => acc + (e.amount ?? 0), 0);
    return { gasto: sum("gasto"), entrada: sum("entrada"), investimento: sum("investimento") };
  }, [entries]);

  const accessLabel = useMemo(() => {
    if (!profile) return "";
    if (profile.status === "active") {
      return profile.active_until ? `Plano ativo — ${daysLeft(profile.active_until)} dia(s)` : "Plano ativo";
    }
    if (profile.status === "trial") {
      const left = daysLeft(profile.trial_ends_at);
      return left > 0 ? `Teste grátis — ${left} dia(s) restantes` : "Teste encerrado";
    }
    return "Acesso encerrado";
  }, [profile]);

  const addNumber = async () => {
    const phone = onlyDigits(newPhone);
    if (!profile || phone.length < 10) {
      toast({ title: "Número inválido", description: "Informe DDD + número.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await acessorDb.from("acessor_numbers").insert({
      user_id: profile.id, phone, is_active: true,
    });
    setSaving(false);
    if (error) {
      toast({
        title: "Não foi possível ativar",
        description: error.message.includes("duplicate")
          ? "Este número já está ativo em algum cadastro."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    setNewPhone("");
    toast({ title: "Número ativado", description: "Agora pode falar com o agente por este número." });
    void load();
  };

  const toggleNumber = async (item: AcessorNumber) => {
    await acessorDb.from("acessor_numbers").update({ is_active: !item.is_active }).eq("id", item.id);
    void load();
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate("/acessor/login", { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Painel Acessor</h1>
            <p className="text-sm text-muted-foreground">
              {profile?.full_name || profile?.email} — {accessLabel}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </header>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Gastos anotados</p>
            <p className="text-2xl font-bold">{formatCurrency(totals.gasto)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Entradas</p>
            <p className="text-2xl font-bold">{formatCurrency(totals.entrada)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Investimentos</p>
            <p className="text-2xl font-bold">{formatCurrency(totals.investimento)}</p>
          </CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Meus números de WhatsApp</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Só números ativados aqui conversam com o agente. Envie mensagens do número ativado.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="acessor-new-number">Número com DDD (e código do país, se fora do Brasil)</Label>
                <Input
                  id="acessor-new-number"
                  inputMode="tel"
                  placeholder="5511999999999"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
              </div>
              <Button onClick={addNumber} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Ativar número
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-md border border-border">
              {numbers.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">Nenhum número ativado ainda.</li>
              )}
              {numbers.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 p-3">
                  <span className="font-medium">{item.phone}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.is_active ? "default" : "secondary"}>
                      {item.is_active ? "Ativo" : "Pausado"}
                    </Badge>
                    <Button size="sm" variant="ghost" onClick={() => toggleNumber(item)}>
                      <Power className="mr-1 h-4 w-4" />
                      {item.is_active ? "Pausar" : "Ativar"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Próximos compromissos</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {appointments.length === 0 && (
                <p className="text-sm text-muted-foreground">Nada agendado. Peça pelo WhatsApp: “reunião amanhã 15h”.</p>
              )}
              {appointments.map((item) => (
                <div key={item.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{formatDateTime(item.starts_at)}</p>
                  {item.notes && <p className="mt-1 text-sm text-muted-foreground">{item.notes}</p>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Anotações recentes</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {entries.length === 0 && (
                <p className="text-sm text-muted-foreground">Nada anotado ainda. Fale: “gasolina 80 reais”.</p>
              )}
              {entries.slice(0, 30).map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div>
                    <p className="font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.kind} {item.category ? `· ${item.category}` : ""} · {formatDateTime(item.occurred_at)}
                    </p>
                  </div>
                  {item.amount !== null && (
                    <span className="whitespace-nowrap font-semibold">{formatCurrency(item.amount)}</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AcessorDashboard;
