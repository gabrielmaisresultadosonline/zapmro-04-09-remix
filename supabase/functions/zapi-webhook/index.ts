import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const isGroupId = (value: string): boolean => {
  return value.includes("@g.us") || value.includes("-");
};

const normalizePhone = (value: string): string => {
  const trimmed = value.trim();
  if (isGroupId(trimmed)) {
    return trimmed.split("@")[0] ?? "";
  }
  const base = trimmed.split("@")[0] ?? "";
  return base.replace(/\D/g, "") || base;
};

const normalizeBrazilianPhone = (phone: string): string => {
  if (phone.includes("-")) return phone;
  const d = phone.replace(/\D/g, "");
  // 13 digits starting with 55 + DDD + 9xxxx -> remove the extra 9
  if (d.length === 13 && d.startsWith("55")) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.startsWith("9") && rest.length === 9) {
      return `55${ddd}${rest.slice(1)}`;
    }
  }
  return d;
};

const safeJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const resolvePhoneFromLid = async (
  supabase: ReturnType<typeof createClient>,
  lid: string,
): Promise<string | null> => {
  const lidValue = lid.trim();
  if (!lidValue.includes("@lid")) return null;

  const { data: settings } = await supabase
    .from("zapi_settings")
    .select("instance_id, token, client_token")
    .limit(1)
    .maybeSingle();

  if (!settings?.instance_id || !settings?.token) return null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.client_token) headers["Client-Token"] = settings.client_token;

  const chatsRes = await fetch(
    `https://api.z-api.io/instances/${settings.instance_id}/token/${settings.token}/chats`,
    { headers },
  );
  const chatsPayload = await safeJson(chatsRes);
  const chatList = Array.isArray(chatsPayload)
    ? chatsPayload
    : (chatsPayload?.chats || chatsPayload?.data || []);

  if (!Array.isArray(chatList)) return null;

  const chat = chatList.find((item: any) => {
    const itemLid = item?.lid || item?.chatLid || "";
    const itemPhone = item?.phone || item?.chatId || item?.waId || "";
    return typeof itemLid === "string" && itemLid === lidValue && typeof itemPhone === "string" && itemPhone.length > 0;
  });

  if (!chat?.phone) return null;
  const resolved = normalizeBrazilianPhone(normalizePhone(chat.phone));
  if (!resolved || resolved.replace(/\D/g, "").length >= 15) return null;
  return resolved;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const payload = await req.json();
    console.log('Z-API Webhook received:', JSON.stringify(payload));

    // Determine event type
    const isMessage = payload.phone && (payload.text || payload.image || payload.audio || payload.document || payload.video || payload.buttonsResponseMessage || payload.listResponseMessage || payload.buttonMessage);
    const isStatus = payload.type === 'DeliveryCallback' || payload.type === 'MessageStatusCallback';
    const isConnection = payload.connected !== undefined;

    if (isMessage) {
      const rawPhone = payload.phone || '';
      const chatIsGroup = isGroupId(rawPhone);
      const rawNormalized = normalizePhone(rawPhone);
      const rawDigits = rawNormalized.replace(/\D/g, '');

      // Resolve LID chats to real phone whenever possible
      let phone = chatIsGroup
        ? rawNormalized
        : normalizeBrazilianPhone(rawNormalized);

      if (!chatIsGroup && rawPhone.includes('@lid')) {
        const resolvedPhone = await resolvePhoneFromLid(supabase, rawPhone);
        if (resolvedPhone) {
          phone = resolvedPhone;

          // Backfill old LID messages/contacts so historical chat appears in the right thread
          if (rawDigits.length >= 15) {
            await supabase.from('zapi_messages').update({ phone: resolvedPhone }).eq('phone', rawDigits);
            await supabase.from('zapi_contacts').delete().eq('phone', rawDigits);
          }
        }
      }

      // If still unresolved LID, skip to avoid duplicate fake contacts
      const phoneDigits = phone.replace(/\D/g, '');
      if (!chatIsGroup && phoneDigits.length >= 15) {
        console.log('Skipping unresolved LID contact:', phone);
        return new Response(JSON.stringify({ success: true, skipped: 'lid_unresolved' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const senderName = payload.senderName || payload.chatName || phone;
      
      let messageType = 'text';
      let content = payload.text?.message || payload.text || '';
      let mediaUrl = null;
      let metadata = null;

      if (payload.image) {
        messageType = 'image';
        mediaUrl = payload.image.imageUrl || payload.image.url;
        content = payload.image.caption || '';
      } else if (payload.audio) {
        messageType = 'audio';
        mediaUrl = payload.audio.audioUrl || payload.audio.url;
      } else if (payload.document) {
        messageType = 'document';
        mediaUrl = payload.document.documentUrl || payload.document.url;
        content = payload.document.fileName || '';
      } else if (payload.video) {
        messageType = 'video';
        mediaUrl = payload.video.videoUrl || payload.video.url;
        content = payload.video.caption || '';
      } else if (payload.buttonsResponseMessage) {
        messageType = 'button_response';
        // Z-API sends buttonId and message fields (not selectedDisplayText/selectedButtonId)
        const btnMessage = payload.buttonsResponseMessage.message || '';
        const btnId = payload.buttonsResponseMessage.buttonId || '';
        // Fallback to legacy field names for compatibility
        const btnDisplayText = payload.buttonsResponseMessage.selectedDisplayText || payload.buttonsResponseMessage.selectedButtonText || '';
        const legacyId = payload.buttonsResponseMessage.selectedButtonId || '';
        content = btnMessage || btnDisplayText || btnId || legacyId || 'Botão selecionado';
        console.log(`[Webhook] Button response: message="${btnMessage}", buttonId="${btnId}", content="${content}"`);
        metadata = {
          selectedButtonId: btnId || legacyId || '',
          selectedDisplayText: btnMessage || btnDisplayText || '',
          selectedButtonText: btnMessage || btnDisplayText || btnId || legacyId || '',
        };
      } else if (payload.listResponseMessage) {
        messageType = 'button_response';
        const selectedRowId =
          payload.listResponseMessage.singleSelectReply?.selectedRowId ||
          payload.listResponseMessage.selectedRowId ||
          payload.listResponseMessage.listType?.toString() ||
          '';
        const selectedTitle =
          payload.listResponseMessage.title ||
          payload.listResponseMessage.singleSelectReply?.title ||
          payload.listResponseMessage.message ||
          '';
        content = selectedTitle || selectedRowId || '';
        metadata = {
          selectedButtonId: selectedRowId,
          selectedDisplayText: selectedTitle || content,
          selectedButtonText: selectedTitle || content,
        };
      } else if (payload.buttonMessage) {
        messageType = 'buttons';
        content = payload.buttonMessage.message || payload.buttonMessage.contentText || '';
        metadata = {
          buttons: (payload.buttonMessage.buttons || []).map((b: any) => ({
            id: b.buttonId || b.id || '',
            label: b.buttonText?.displayText || b.label || b.buttonId || '',
          })),
          title: payload.buttonMessage.title || null,
          footer: payload.buttonMessage.footerText || null,
        };
      }

      // If content is an object (e.g. {message: "text"}), extract the string
      if (typeof content === 'object' && content !== null) {
        content = (content as any).message || JSON.stringify(content);
      }

      // Some interactive replies (list/buttons) may come with fromMe=true in Z-API;
      // they must still be treated as incoming user replies for flow progression.
      const isInteractiveReply = messageType === 'button_response';
      const direction = isInteractiveReply ? 'incoming' : (payload.fromMe ? 'outgoing' : 'incoming');
      const messageId = payload.messageId || payload.zaapId || null;

      // Idempotency: same webhook message must be processed only once
      if (messageId) {
        const { data: existingMessage } = await supabase
          .from('zapi_messages')
          .select('id')
          .eq('message_id', messageId)
          .limit(1)
          .maybeSingle();

        if (existingMessage) {
          console.log(`[Webhook] Duplicate message ignored: ${messageId}`);
          return new Response(JSON.stringify({ success: true, skipped: 'duplicate_message' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Save message
      const { error: msgError } = await supabase.from('zapi_messages').insert({
        message_id: messageId,
        phone,
        contact_name: senderName,
        direction,
        message_type: messageType,
        content,
        media_url: mediaUrl,
        metadata,
        status: direction === 'incoming' ? 'received' : 'sent',
        is_read: direction === 'outgoing',
        timestamp: payload.momment || payload.timestamp || Date.now(),
      });

      if (msgError) {
        console.error('Error saving message:', msgError);
      }

      // Upsert contact
      const contactData: Record<string, unknown> = {
        phone,
        name: senderName,
        is_group: chatIsGroup,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (direction === 'incoming') {
        const { data: existingContact } = await supabase
          .from('zapi_contacts')
          .select('unread_count')
          .eq('phone', phone)
          .single();

        contactData.unread_count = (existingContact?.unread_count || 0) + 1;
      }

      await supabase.from('zapi_contacts').upsert(contactData, { onConflict: 'phone' });

      // --- Flow handling on incoming messages ---
      if (direction === 'incoming' && typeof content === 'string' && content.trim().length > 0) {
        const contentLower = content.toLowerCase().trim();

        let matchedKeywordFlowId: string | null = null;
        const { data: keywordFlows } = await supabase
          .from('zapi_flows')
          .select('id, trigger_keywords, trigger_specific_text')
          .eq('is_active', true)
          .eq('trigger_type', 'keyword');

        if (keywordFlows && keywordFlows.length > 0) {
          for (const flow of keywordFlows) {
            if (flow.trigger_specific_text && flow.trigger_specific_text.trim().length > 0) {
              if (contentLower !== flow.trigger_specific_text.toLowerCase().trim()) continue;
            }

            const keywords: string[] = Array.isArray(flow.trigger_keywords) ? flow.trigger_keywords : [];
            if (keywords.length === 0) continue;

            const matched = keywords.some((kw: string) => contentLower.includes(kw.toLowerCase().trim()));
            if (matched) {
              matchedKeywordFlowId = flow.id;
              break;
            }
          }
        }

        // Prevent duplicate executions of the same keyword-triggered flow for the same contact
        if (matchedKeywordFlowId) {
          const { data: alreadyRan } = await supabase
            .from('zapi_flow_executions')
            .select('id')
            .eq('phone', phone)
            .eq('flow_id', matchedKeywordFlowId)
            .in('status', ['completed', 'running', 'paused'])
            .limit(1)
            .maybeSingle();

          if (alreadyRan) {
            matchedKeywordFlowId = null;
          }
        }

        // First priority: if there is a paused execution (wait for reply), resume it
        const { data: pausedExec } = await supabase
          .from('zapi_flow_executions')
          .select('id')
          .eq('phone', phone)
          .eq('status', 'paused')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

        if (pausedExec?.id) {
          const isButtonReply = messageType === 'button_response';

          // If user clicked a button/list option that maps to a keyword trigger,
          // prioritize the new trigger instead of keeping the old paused flow.
          if (isButtonReply && matchedKeywordFlowId) {
            console.log(`[Webhook] Button reply matched keyword flow ${matchedKeywordFlowId}; switching from paused execution ${pausedExec.id}`);

            const nowIso = new Date().toISOString();
            await supabase
              .from('zapi_flow_executions')
              .update({
                status: 'completed',
                completed_at: nowIso,
                paused_at: null,
                last_step_at: nowIso,
              })
              .eq('id', pausedExec.id);

            fetch(`${supabaseUrl}/functions/v1/zapi-proxy`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`,
                'apikey': serviceKey,
              },
              body: JSON.stringify({
                action: 'execute-flow',
                data: { flowId: matchedKeywordFlowId, phone },
              }),
            }).catch(err => console.error('[Webhook] Flow trigger error (button->keyword):', err));
          } else {
            console.log(`[Webhook] Resuming paused flow execution ${pausedExec.id} for ${phone}`);

            fetch(`${supabaseUrl}/functions/v1/zapi-proxy`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`,
                'apikey': serviceKey,
              },
              body: JSON.stringify({
                action: 'resume-execution',
                data: { executionId: pausedExec.id, phone },
              }),
            }).catch(err => console.error('[Webhook] Flow resume error:', err));
          }
        } else {
          // If no paused execution, check running (don't stack flows)
          const { data: runningExec } = await supabase
            .from('zapi_flow_executions')
            .select('id')
            .eq('phone', phone)
            .eq('status', 'running')
            .limit(1)
            .maybeSingle();

          if (!runningExec) {
            let matchedFlowId: string | null = matchedKeywordFlowId;

            if (matchedFlowId) {
              console.log(`[Webhook] Keyword match! Triggering flow ${matchedFlowId} for ${phone}`);
            }

            // 2) Check first_message flows ONLY if no keyword matched
            if (!matchedFlowId) {
              const { data: triggerFlows } = await supabase
                .from('zapi_flows')
                .select('id, trigger_type')
                .eq('is_active', true)
                .in('trigger_type', ['first_message', 'first_message_day', '24h_inactivity', 'inactivity_30m', 'inactivity_1h', 'inactivity_2h']);

              if (triggerFlows && triggerFlows.length > 0) {
                // Get most recent incoming message BEFORE the one we just saved
                const { data: lastMessages } = await supabase
                  .from('zapi_messages')
                  .select('created_at')
                  .eq('phone', phone)
                  .eq('direction', 'incoming')
                  .order('created_at', { ascending: false })
                  .limit(2); // Get current and previous

                const previousMsg = lastMessages && lastMessages.length > 1 ? lastMessages[1] : null;
                const totalIncomingCount = lastMessages ? lastMessages.length : 0;
                
                // First Message (Total)
                if (!previousMsg) {
                  const flow = triggerFlows.find(f => f.trigger_type === 'first_message');
                  if (flow) {
                    matchedFlowId = flow.id;
                    console.log(`[Webhook] First message (ever) detected! Flow: ${matchedFlowId}`);
                  }
                }
                
                // First Message of the Day
                if (!matchedFlowId) {
                  const flowOfDay = triggerFlows.find(f => f.trigger_type === 'first_message_day');
                  if (flowOfDay) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    
                    // Count messages from today (excluding the one just saved if we want "first")
                    // Actually easier to check if previousMsg was before today
                    if (!previousMsg || new Date(previousMsg.created_at) < today) {
                      matchedFlowId = flowOfDay.id;
                      console.log(`[Webhook] First message of the day detected! Flow: ${matchedFlowId}`);
                    }
                  }
                }

                // 24h Inactivity
                if (!matchedFlowId) {
                  const flow24h = triggerFlows.find(f => f.trigger_type === '24h_inactivity');
                  if (flow24h && previousMsg) {
                    const lastMsgDate = new Date(previousMsg.created_at);
                    const now = new Date();
                    const diffHours = (now.getTime() - lastMsgDate.getTime()) / (1000 * 60 * 60);
                    
                    if (diffHours >= 24) {
                      matchedFlowId = flow24h.id;
                      console.log(`[Webhook] 24h inactivity detected! Flow: ${matchedFlowId}`);
                    }
                  }
                }

                // Inatividade curta (30min / 1h / 2h)
                if (!matchedFlowId && previousMsg) {
                  const diffMs = new Date().getTime() - new Date(previousMsg.created_at).getTime();
                  const shortThresholds: Array<[string, number]> = [
                    ['inactivity_2h', 2 * 60 * 60 * 1000],
                    ['inactivity_1h', 60 * 60 * 1000],
                    ['inactivity_30m', 30 * 60 * 1000],
                  ];
                  for (const [type, ms] of shortThresholds) {
                    const f = triggerFlows.find(tf => tf.trigger_type === type);
                    if (f && diffMs >= ms) {
                      matchedFlowId = f.id;
                      console.log(`[Webhook] Inactivity ${type} detected! Flow: ${matchedFlowId}`);
                      break;
                    }
                  }
                }

              }
            }

            if (matchedFlowId) {
              console.log(`[Webhook] Triggering flow ${matchedFlowId} for ${phone}`);

              fetch(`${supabaseUrl}/functions/v1/zapi-proxy`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${serviceKey}`,
                  'apikey': serviceKey,
                },
                body: JSON.stringify({
                  action: 'execute-flow',
                  data: { flowId: matchedFlowId, phone },
                }),
              }).catch(err => console.error('[Webhook] Flow trigger error:', err));
            }
          } else {
            console.log(`[Webhook] Skipping keyword trigger - already running flow for ${phone}`);
          }
        }
      }
    }

    if (isStatus && payload.messageId) {
      let status = 'sent';
      if (payload.status === 'RECEIVED' || payload.status === 'DELIVERED') status = 'delivered';
      if (payload.status === 'READ') status = 'read';

      await supabase
        .from('zapi_messages')
        .update({ status })
        .eq('message_id', payload.messageId);
    }

    if (isConnection) {
      await supabase
        .from('zapi_settings')
        .update({ 
          is_connected: payload.connected,
          updated_at: new Date().toISOString()
        })
        .neq('id', '00000000-0000-0000-0000-000000000000');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Z-API webhook error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function downloadAndUploadZapiMedia(supabase: any, url: string, type: string) {
  if (!url) return null;
  try {
    console.log(`Downloading Z-API media from: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download: ${res.statusText}`);
    const blob = await res.blob();
    const mimeType = blob.type || 'application/octet-stream';
    const ext = mimeType.split('/')[1] || 'bin';
    const filePath = `zapi/${type}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('crm-media')
      .upload(filePath, blob, { contentType: mimeType, upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('crm-media').getPublicUrl(filePath);
    return publicUrl;
  } catch (err) {
    console.error(`Error processing Z-API media:`, err);
    return url; // Fallback to original URL if upload fails
  }
}
