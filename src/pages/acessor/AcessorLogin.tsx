import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { acessorDb, onlyDigits } from "@/lib/acessorApi";
import { Loader2 } from "lucide-react";

/** Login e cadastro do Acessor (rota /acessor/login). */
const AcessorLogin = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isRegistering, setIsRegistering] = useState(params.get("cadastro") === "1");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate("/acessor/dashboard", { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  /** Garante a linha em acessor_profiles (o teste de 2 dias vem do banco). */
  const ensureProfile = async (userId: string, mail: string) => {
    const { data } = await acessorDb.from("acessor_profiles").select("id").eq("id", userId).maybeSingle();
    if (data) return;
    const { error } = await acessorDb.from("acessor_profiles").insert({
      id: userId,
      email: mail,
      full_name: fullName || null,
      whatsapp: whatsapp ? onlyDigits(whatsapp) : null,
    });
    if (error) console.error("[acessor] falha ao criar cadastro:", error.message);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/acessor/dashboard` },
        });
        if (error) throw error;
        if (data.user) await ensureProfile(data.user.id, email.trim());
        if (!data.session) {
          toast({ title: "Cadastro criado", description: "Confirme seu e-mail e depois entre para acessar o painel." });
          setIsRegistering(false);
          return;
        }
        toast({ title: "Bem-vindo!", description: "Seu teste de 2 dias começou agora." });
        navigate("/acessor/dashboard", { replace: true });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      if (data.user) await ensureProfile(data.user.id, data.user.email ?? email.trim());
      navigate("/acessor/dashboard", { replace: true });
    } catch (error) {
      toast({
        title: isRegistering ? "Não foi possível cadastrar" : "Não foi possível entrar",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{isRegistering ? "Criar cadastro no Acessor" : "Entrar no Acessor"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="acessor-name">Seu nome</Label>
                  <Input id="acessor-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="acessor-whats">WhatsApp com DDD</Label>
                  <Input
                    id="acessor-whats"
                    inputMode="tel"
                    placeholder="11999999999"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-1">
              <Label htmlFor="acessor-email">E-mail</Label>
              <Input id="acessor-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acessor-pass">Senha</Label>
              <Input
                id="acessor-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isRegistering ? "Criar cadastro e testar 2 dias" : "Entrar"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setIsRegistering((value) => !value)}
          >
            {isRegistering ? "Já tenho cadastro, quero entrar" : "Não tenho cadastro, quero testar 2 dias"}
          </button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            <Link to="/acessor" className="underline-offset-4 hover:underline">Voltar para a página do Acessor</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AcessorLogin;
