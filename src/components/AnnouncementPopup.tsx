import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone } from "lucide-react";

type Announcement = {
  id: string;
  title: string;
  message: string;
  frequency: "once" | "always" | "twice" | "date_range";
  start_date: string | null;
  end_date: string | null;
  active: boolean;
};

type View = {
  announcement_id: string;
  view_count: number;
  dismissed_at: string | null;
};

const CUSTOM_RETENTION_NOTICE_ID = "10810810-0000-4000-8000-000000000001";

export default function AnnouncementPopup() {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const now = new Date().toISOString();
      const { data: anns } = await supabase
        .from("admin_announcements")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (!anns || anns.length === 0) return;

      const { data: views } = await supabase
        .from("admin_announcement_views")
        .select("announcement_id, view_count, dismissed_at")
        .eq("user_id", user.id);
      const viewMap = new Map<string, View>((views || []).map((v: any) => [v.announcement_id, v]));

      const eligible = (anns as Announcement[]).filter((a) => {
        if (a.id === CUSTOM_RETENTION_NOTICE_ID) return false;
        if (a.frequency === "date_range") {
          if (a.start_date && now < a.start_date) return false;
          if (a.end_date && now > a.end_date) return false;
        }
        const v = viewMap.get(a.id);
        if (v?.dismissed_at) return false;
        const count = v?.view_count || 0;
        if (a.frequency === "once") return count < 1;
        if (a.frequency === "twice") return count < 2;
        return true; // always & date_range
      });
      setQueue(eligible);
    })();
  }, []);

  useEffect(() => {
    if (!current && queue.length > 0) setCurrent(queue[0]);
  }, [queue, current]);

  async function dismiss(permanent: boolean) {
    if (!current || !userId) return;
    const ann = current;
    const { data: existing } = await supabase
      .from("admin_announcement_views")
      .select("id, view_count")
      .eq("user_id", userId)
      .eq("announcement_id", ann.id)
      .maybeSingle();
    const payload: any = {
      user_id: userId,
      announcement_id: ann.id,
      view_count: (existing?.view_count || 0) + 1,
      last_viewed_at: new Date().toISOString(),
    };
    if (permanent) payload.dismissed_at = new Date().toISOString();
    if (existing) {
      await supabase.from("admin_announcement_views").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("admin_announcement_views").insert(payload);
    }
    setCurrent(null);
    setQueue((q) => q.slice(1));
  }

  if (!current) return null;

  return (
    <Dialog open={!!current} onOpenChange={(o) => { if (!o) dismiss(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#075E54]">
            <Megaphone className="h-5 w-5 text-[#25D366]" />
            {current.title}
          </DialogTitle>
        </DialogHeader>
        <div className="whitespace-pre-wrap text-sm text-foreground/90 py-2">
          {current.message}
        </div>
        <DialogFooter className="gap-2">
          {current.frequency === "always" && (
            <Button variant="outline" onClick={() => dismiss(true)}>Não mostrar mais</Button>
          )}
          <Button className="bg-[#25D366] hover:bg-[#128C7E] text-white" onClick={() => dismiss(false)}>
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}