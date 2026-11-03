import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Download, Loader2, Video as VideoIcon, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const TARGET_MB = 15.5; // margem de segurança abaixo dos 16MB do WhatsApp
const TARGET_BYTES = TARGET_MB * 1024 * 1024;

type Stage = 'idle' | 'analyzing' | 'converting' | 'done' | 'error';

export default function ConverterVideo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState<number>(0);
  const [warning, setWarning] = useState<string>('');
  const [info, setInfo] = useState<string>('');

  const reset = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setDuration(0);
    setStage('idle');
    setProgress(0);
    setResultUrl(null);
    setResultSize(0);
    setWarning('');
    setInfo('');
  };

  const onPick = async (f: File) => {
    reset();
    if (!f.type.startsWith('video/')) {
      toast({ title: 'Selecione um arquivo de vídeo', variant: 'destructive' });
      return;
    }
    setFile(f);
    setStage('analyzing');

    // Carrega duração
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    await new Promise<void>((resolve) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => resolve();
    });
    const dur = v.duration || 0;
    setDuration(dur);
    URL.revokeObjectURL(url);

    const sizeMB = f.size / 1024 / 1024;

    if (f.size <= TARGET_BYTES) {
      setInfo(`Seu vídeo já tem ${sizeMB.toFixed(1)}MB — está dentro do limite de 16MB do WhatsApp! Você pode baixar como está ou converter mesmo assim.`);
      setStage('idle');
      return;
    }

    // Estimativa de bitrate alvo
    if (dur > 0) {
      const targetBitrateKbps = Math.floor((TARGET_BYTES * 8) / dur / 1000);
      if (targetBitrateKbps < 350) {
        setWarning(
          `Atenção: seu vídeo tem ${sizeMB.toFixed(1)}MB e ${Math.round(dur)}s. Para caber em 16MB precisamos reduzir muito a qualidade (aprox. ${targetBitrateKbps}kbps). O resultado pode ficar com qualidade baixa. Recomendamos cortar o vídeo antes ou gravar em qualidade menor.`
        );
      } else {
        setInfo(`Tudo certo! Vamos converter ${sizeMB.toFixed(1)}MB → até ${TARGET_MB}MB sem perder muita qualidade (aprox. ${targetBitrateKbps}kbps).`);
      }
    }
    setStage('idle');
  };

  const convert = async () => {
    if (!file) return;
    setStage('converting');
    setProgress(0);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultSize(0);

    try {
      const srcUrl = URL.createObjectURL(file);
      const video = videoRef.current!;
      video.src = srcUrl;
      video.muted = false;
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error('Erro ao carregar vídeo'));
      });

      const dur = video.duration;
      const targetBitrate = Math.max(
        250_000,
        Math.floor((TARGET_BYTES * 8) / dur) - 64_000 // reserva para áudio
      );
      const audioBitrate = 64_000;

      // captureStream do video element (inclui áudio)
      const stream: MediaStream = video.captureStream
          ? video.captureStream()
        : // @ts-expect-error
          video.mozCaptureStream();

      // Escolhe mimeType suportado
      const candidates = [
        'video/mp4;codecs=h264,aac',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];
      const mimeType = candidates.find((c) => MediaRecorder.isTypeSupported(c)) || '';
      if (!mimeType) throw new Error('Navegador não suporta MediaRecorder para vídeo. Use o Chrome ou Edge mais recente.');

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: targetBitrate,
        audioBitsPerSecond: audioBitrate,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      const stopPromise = new Promise<Blob>((res) => {
        recorder.onstop = () => res(new Blob(chunks, { type: mimeType }));
      });

      recorder.start(250);
      video.currentTime = 0;
      await video.play();

      const tick = () => {
        if (video.ended || recorder.state === 'inactive') return;
        setProgress(Math.min(99, Math.round((video.currentTime / dur) * 100)));
        requestAnimationFrame(tick);
      };
      tick();

      await new Promise<void>((res) => {
        video.onended = () => res();
      });

      if (recorder.state !== 'inactive') recorder.stop();
      const blob = await stopPromise;
      URL.revokeObjectURL(srcUrl);

      const outUrl = URL.createObjectURL(blob);
      setResultUrl(outUrl);
      setResultSize(blob.size);
      setProgress(100);
      setStage('done');

      if (blob.size > 16 * 1024 * 1024) {
        toast({
          title: 'Ainda acima de 16MB',
          description: 'A conversão não conseguiu chegar abaixo de 16MB. Tente cortar o vídeo antes.',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Conversão concluída!', description: `Tamanho final: ${(blob.size/1024/1024).toFixed(2)}MB` });
      }
    } catch (e: any) {
      console.error(e);
      setStage('error');
      toast({ title: 'Erro ao converter', description: e.message, variant: 'destructive' });
    }
  };

  const download = () => {
    if (!resultUrl || !file) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    const ext = (resultUrl.includes('webm') ? 'webm' : 'mp4');
    const base = file.name.replace(/\.[^.]+$/, '');
    a.download = `${base}-zapmro-16mb.${ext}`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-[#0b141a] text-white px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#00a884]/15 text-[#00a884] mb-2">
            <VideoIcon className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold">Converter vídeo para WhatsApp (até 16MB)</h1>
          <p className="text-white/60 text-sm">
            100% no seu navegador — nada é enviado para a nuvem. Se você atualizar a página, tudo é apagado.
          </p>
        </div>

        <div className="bg-[#202c33] border border-white/5 rounded-2xl p-6 space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
          />

          {!file && (
            <Button
              onClick={() => inputRef.current?.click()}
              className="w-full h-32 bg-[#2a3942] hover:bg-[#2a3942]/80 border-2 border-dashed border-white/10 text-white/70 flex flex-col gap-2"
            >
              <Upload className="w-6 h-6" />
              <span>Clique para selecionar um vídeo</span>
              <span className="text-xs text-white/40">MP4, MOV, WEBM…</span>
            </Button>
          )}

          {file && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <div className="truncate">
                  <p className="text-white font-medium truncate">{file.name}</p>
                  <p className="text-white/50 text-xs">
                    {(file.size / 1024 / 1024).toFixed(2)}MB · {duration ? `${Math.round(duration)}s` : '—'}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={reset} className="text-white/40 hover:text-white">
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {warning && (
                <div className="flex gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{warning}</p>
                </div>
              )}
              {info && (
                <div className="flex gap-2 bg-[#00a884]/10 border border-[#00a884]/30 text-[#00a884] text-sm rounded-lg p-3">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <p>{info}</p>
                </div>
              )}

              {/* Player oculto usado para captureStream */}
              <video ref={videoRef} className="hidden" playsInline />

              {stage === 'converting' && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-white/60">
                    <span>Convertendo no seu navegador…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 bg-[#2a3942] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00a884] transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              {stage !== 'done' && (
                <Button
                  onClick={convert}
                  disabled={stage === 'converting' || stage === 'analyzing'}
                  className="w-full bg-[#00a884] hover:bg-[#00a884]/80 text-white"
                >
                  {stage === 'converting' ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Convertendo…</>
                  ) : (
                    <><VideoIcon className="w-4 h-4 mr-2" /> Converter agora</>
                  )}
                </Button>
              )}

              {stage === 'done' && resultUrl && (
                <div className="space-y-3">
                  <video src={resultUrl} controls className="w-full rounded-lg bg-black max-h-64" />
                  <div className="text-sm text-white/70 text-center">
                    Tamanho final: <span className="text-white font-semibold">{(resultSize / 1024 / 1024).toFixed(2)}MB</span>
                    {resultSize <= 16 * 1024 * 1024 ? ' ✅ dentro do limite' : ' ⚠️ ainda acima de 16MB'}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={download} className="flex-1 bg-[#00a884] hover:bg-[#00a884]/80 text-white">
                      <Download className="w-4 h-4 mr-2" /> Baixar vídeo
                    </Button>
                    <Button onClick={reset} variant="ghost" className="text-white/60 hover:text-white bg-[#2a3942]">
                      Converter outro
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-white/40">
          🔒 Privacidade total: a conversão acontece no seu navegador via MediaRecorder. Nenhum vídeo é enviado para nossos servidores.
        </p>
      </div>
    </div>
  );
}