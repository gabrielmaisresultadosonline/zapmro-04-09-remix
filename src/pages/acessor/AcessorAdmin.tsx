import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ADMIN_TOKEN_KEY, callAcessorAdmin, formatDateTime } from "@/lib/acessorApi";
import { Loader2, RefreshCw } from "lucide-react";

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  whatsapp: string | null;
  status: string;
  trial_ends_at: string;
  active_until: string | null;
  created_at: string;
  numbers: { phone: string; is_active: boolean }[];
}

interface AdminSettings {
  openai_model: string;
  has_openai_key: boolean;
  meta_phone_number_id: string;
  meta_waba_id: string;
  meta_business_id: string;
  meta_app_id: string;
  meta_display_phone_number: string;
  meta_verify_token: string;
  has_meta_token: boolean;
  coexistence: boolean;
  agent_prompt: string;
  unregistered_prompt: string;
  trial_days: number;
}

interface OverviewResponse {
  success: boolean;
  error?: string;
  stats: Record<string, number>;
  users: AdminUser[];
  settings: AdminSettings;
}

/** Painel administrativo do Acessor (rota /acessor/admin). */
const AcessorAdmin = () => {
  const { toast } = useToast();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(ADMIN_TOKEN_KEY));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [numberInputs, setNumberInputs] = useState<Record<string, string>>({});

  const refresh = useCallback(async (activeToken: string) => {
    setLoading(true);
    try {
      const data = await callAcessorAdmin<OverviewResponse>("overview", {}, activeToken);
      if (!data.success) throw new Error(data.error || "Falha ao carregar");
      setStats(data.stats);
      setUsers(data.users);
      setSettings(data.settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar";
      if (message.toLowerCase().includes("sessão")) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setToken(null);
      }
      toast({ title: "Erro", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (token) void refresh(token); }, [token, refresh]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await callAcessorAdmin<{ success: boolean; token?: string; error?: string }>("login", {
        email: email.trim(), password,
      });
      if (!data.success || !data.token) throw new Error(data.error || "Credenciais inválidas");
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword("");
    } catch (error) {
      toast({ title: "Login recusado", description: error instanceof Error ? error.message : "Tente novamente", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: string, payload: Record<string, unknown>, successMessage: string) => {
    if (!token) return;
    setBusy(true);
    try {
      const data = await callAcessorAdmin<{ success: boolean; error?: string }>(action, payload, token);
      if (!data.success) throw new Error(data.error || "Falha na operação");
      toast({ title: successMessage });
      await refresh(token);
    } catch (error) {
      toast({ title: "Erro", description: error instanceof Error ? error.message : "Falha", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    await run("save_settings", {
      settings: {
        ...settings,
        openai_api_key: openaiKey,
        meta_access_token: metaToken,
        meta_app_secret: metaAppSecret,
      },
    }, "Configurações salvas");
    setOpenaiKey("");
    setMetaToken("");
    setMetaAppSecret("");
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle>Admin Acessor</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={login} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="admin-email">E-mail</Label>
                <Input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-pass">Senha</Label>
                <Input id="admin-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Entrar
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Admin Acessor</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => token && refresh(token)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(null); }}>
              Sair
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {[
            ["Cadastros", stats.total], ["Em teste", stats.trial], ["Ativos", stats.active],
            ["Expirados", stats.expired], ["Números", stats.numbers],
            ["Anotações", stats.entries], ["Agendamentos", stats.appointments],
          ].map(([label, value]) => (
            <Card key={String(label)}><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold">{value ?? 0}</p>
            </CardContent></Card>
          ))}
        </div>

        {settings && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">OpenAI (ChatGPT)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="openai-key">
                    Token da OpenAI {settings.has_openai_key && <Badge variant="secondary" className="ml-2">salvo</Badge>}
                  </Label>
                  <Input
                    id="openai-key" type="password" placeholder="sk-..." autoComplete="off"
                    value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Deixe vazio para manter o token já salvo.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="openai-model">Modelo</Label>
                  <Input
                    id="openai-model" value={settings.openai_model}
                    onChange={(e) => setSettings({ ...settings, openai_model: e.target.value })}
                  />
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
                  try {
                    const data = await callAcessorAdmin<{ success: boolean; error?: string }>(
                      "test_openai", { openai_api_key: openaiKey }, token,
                    );
                    if (!data.success) throw new Error(data.error);
                    toast({ title: "Chave válida ✅" });
                  } catch (error) {
                    toast({ title: "Chave recusada", description: error instanceof Error ? error.message : "", variant: "destructive" });
                  }
                }}>Testar chave</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">WhatsApp API oficial (Meta)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="meta-token">
                    Access token {settings.has_meta_token && <Badge variant="secondary" className="ml-2">salvo</Badge>}
                  </Label>
                  <Input id="meta-token" type="password" autoComplete="off" value={metaToken} onChange={(e) => setMetaToken(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {([
                    ["meta_phone_number_id", "Phone Number ID"],
                    ["meta_waba_id", "WABA ID"],
                    ["meta_business_id", "Business ID"],
                    ["meta_app_id", "App ID"],
                    ["meta_verify_token", "Verify token do webhook"],
                  ] as const).map(([field, label]) => (
                    <div key={field} className="space-y-1">
                      <Label htmlFor={field}>{label}</Label>
                      <Input
                        id={field} value={settings[field]}
                        onChange={(e) => setSettings({ ...settings, [field]: e.target.value })}
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label htmlFor="meta-secret">App secret</Label>
                    <Input id="meta-secret" type="password" autoComplete="off" value={metaAppSecret} onChange={(e) => setMetaAppSecret(e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Coexistência</p>
                    <p className="text-xs text-muted-foreground">
                      Ligue quando o número seguir também no app do WhatsApp Business.
                    </p>
                  </div>
                  <Switch
                    checked={settings.coexistence}
                    onCheckedChange={(checked) => setSettings({ ...settings, coexistence: checked })}
                  />
                </div>
                {settings.meta_display_phone_number && (
                  <p className="text-xs text-muted-foreground">Número conectado: {settings.meta_display_phone_number}</p>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={async () => {
                  try {
                    const data = await callAcessorAdmin<{ success: boolean; error?: string }>("test_whatsapp", {}, token);
                    if (!data.success) throw new Error(data.error);
                    toast({ title: "WhatsApp conectado ✅" });
                    if (token) await refresh(token);
                  } catch (error) {
                    toast({ title: "Falha na conexão", description: error instanceof Error ? error.message : "", variant: "destructive" });
                  }
                }}>Conectar / testar WhatsApp</Button>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Prompts do agente</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="agent-prompt">Prompt do agente (clientes com cadastro ativo)</Label>
                  <Textarea
                    id="agent-prompt" rows={5} value={settings.agent_prompt}
                    onChange={(e) => setSettings({ ...settings, agent_prompt: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="unreg-prompt">Resposta para quem não tem cadastro ativo</Label>
                  <Textarea
                    id="unreg-prompt" rows={3} value={settings.unregistered_prompt}
                    onChange={(e) => setSettings({ ...settings, unregistered_prompt: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="trial-days">Dias de teste</Label>
                  <Input
                    id="trial-days" type="number" min={0} className="max-w-[120px]"
                    value={settings.trial_days}
                    onChange={(e) => setSettings({ ...settings, trial_days: Number(e.target.value) })}
                  />
                </div>
                <Button onClick={saveSettings} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar configurações
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Cadastros</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {users.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cadastro ainda.</p>}
            {users.map((user) => (
              <div key={user.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{user.full_name || user.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.email} · criado {formatDateTime(user.created_at)} ·{" "}
                      {user.status === "active"
                        ? `ativo até ${user.active_until ? formatDateTime(user.active_until) : "sem prazo"}`
                        : `teste até ${formatDateTime(user.trial_ends_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={user.status === "active" ? "default" : "secondary"}>{user.status}</Badge>
                    <Button size="sm" disabled={busy} onClick={() => run("set_user_status", { user_id: user.id, status: "active", days: 30 }, "Cliente ativado por 30 dias")}>
                      Ativar 30 dias
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run("set_user_status", { user_id: user.id, status: "expired" }, "Acesso encerrado")}>
                      Encerrar
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {user.numbers.map((n) => (
                    <Badge key={n.phone} variant={n.is_active ? "default" : "secondary"}>
                      {n.phone} {n.is_active ? "" : "(pausado)"}
                    </Badge>
                  ))}
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-8 w-44" placeholder="5511999999999"
                      value={numberInputs[user.id] ?? ""}
                      onChange={(e) => setNumberInputs({ ...numberInputs, [user.id]: e.target.value })}
                    />
                    <Button size="sm" variant="outline" disabled={busy} onClick={() =>
                      run("add_number", { user_id: user.id, phone: numberInputs[user.id] ?? "" }, "Número ativado")
                    }>
                      Conectar número
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AcessorAdmin;
