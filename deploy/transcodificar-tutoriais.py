#!/usr/bin/env python3
"""Converte UM vídeo de tutorial pendente em HLS adaptativo (240p..720p).

Chamado em laço por deploy/zapmro-tutorial-transcoder.sh. Reserva a linha
atomicamente (FOR UPDATE SKIP LOCKED), baixa o original pelo gateway local,
gera as qualidades com ffmpeg, envia ao Storage (bucket assets) e grava
hls_url. Em falha marca 'error' — o original continua tocando normalmente.
Saída 0 = processou algo, 3 = fila vazia, 1 = erro.
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.parse

DB_CONT = os.environ.get("DB_CONT", "zapmro-db")
GW = f"http://127.0.0.1:{os.environ.get('GATEWAY_PORT', '8000')}"
KEY = os.environ.get("SERVICE_ROLE_KEY", "")
ANON = os.environ.get("ANON_KEY", "")
BUCKET = "assets"
MARK = "/storage/v1/object/public/"
# (altura do lado menor, kbps vídeo, kbps áudio)
LADDER = [(240, 350, 64), (360, 700, 96), (480, 1100, 96), (720, 2200, 128)]


def sql(q):
    r = subprocess.run(["docker", "exec", "-i", DB_CONT, "psql", "-U", "postgres", "-d", "postgres",
                        "-At", "-v", "ON_ERROR_STOP=1", "-c", q], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400])
    return r.stdout.strip()


def lit(s):
    return "'" + str(s).replace("'", "''") + "'"


def headers(extra=None):
    h = {"Authorization": f"Bearer {KEY}", "apikey": ANON or KEY}
    h.update(extra or {})
    return h


def storage(method, path, data=None, ctype="application/json"):
    req = urllib.request.Request(f"{GW}/storage/v1/{path}", data=data, method=method,
                                 headers=headers({"Content-Type": ctype, "x-upsert": "true",
                                                  "cache-control": "max-age=31536000"}))
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def remove_prefix(prefix):
    try:
        names = []
        body = json.dumps({"prefix": prefix, "limit": 1000}).encode()
        for item in json.loads(storage("POST", f"object/list/{BUCKET}", body)):
            if item.get("id"):
                names.append(f"{prefix}/{item['name']}")
        if names:
            storage("DELETE", f"object/{BUCKET}", json.dumps({"prefixes": names}).encode())
    except Exception as e:  # limpeza é melhor esforço
        print(f"[transcoder] aviso: não removeu versão antiga {prefix}: {e}")


def step(tid, text, pct):
    try:
        sql(f"UPDATE public.sales_tutorials SET transcode_step={lit(text)}, transcode_progress={int(pct)} WHERE id={lit(tid)};")
    except Exception:
        pass


def main():
    if not KEY:
        print("[transcoder] SERVICE_ROLE_KEY ausente"); return 1
    row = sql("""
      UPDATE public.sales_tutorials t SET transcode_status='processing', transcode_started_at=now(), transcode_error=NULL, transcode_step='iniciando', transcode_progress=0
       WHERE t.id = (SELECT id FROM public.sales_tutorials
                      WHERE video_url IS NOT NULL
                        AND (transcode_status='pending'
                             OR (transcode_status='error' AND transcode_started_at < now()-interval '15 minutes'
                                 AND transcode_error ILIKE ANY (ARRAY['%closed connection%','%timed out%','%refused%','%reset%','%HTTP Error 5%','%download falhou%']))
                             OR (transcode_status='processing' AND transcode_started_at < now()-interval '2 hours'))
                      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING json_build_object('id',t.id,'video_url',t.video_url,'hls_url',t.hls_url);""")
    if not row:
        return 3
    job = json.loads(row.splitlines()[0])
    tid, src = job["id"], job["video_url"]
    work = tempfile.mkdtemp(prefix="tut-hls-")
    try:
        if MARK not in src:
            raise RuntimeError("vídeo fora do Storage do sistema")
        public_base, obj = src.split(MARK, 1)
        print(f"[transcoder] {tid}: baixando {obj}")
        step(tid, "baixando o vídeo original", 2)
        local = os.path.join(work, "src")
        last = None
        for attempt in range(6):  # o gateway pode estar reiniciando (ex.: durante a atualização)
            try:
                req = urllib.request.Request(f"{GW}{MARK}{obj}", headers=headers())
                with urllib.request.urlopen(req, timeout=600) as r, open(local, "wb") as f:
                    shutil.copyfileobj(r, f)
                last = None
                break
            except Exception as e:
                last = e
                print(f"[transcoder] {tid}: download falhou ({e}), tentativa {attempt + 1}/6")
                time.sleep(10 * (attempt + 1))
        if last:
            raise last

        probe = json.loads(subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
             "-show_entries", "format=duration", "-of", "json", local],
            capture_output=True, text=True, check=True).stdout)
        st = probe["streams"][0]
        w, h = int(st["width"]), int(st["height"])
        short = min(w, h)
        has_audio = bool(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
                                         "stream=index", "-of", "csv=p=0", local],
                                        capture_output=True, text=True).stdout.strip())
        ladder = [l for l in LADDER if l[0] <= short] or [LADDER[0]]

        out = os.path.join(work, "hls")
        os.makedirs(out)
        master = ["#EXTM3U", "#EXT-X-VERSION:3"]
        for idx, (size, vk, ak) in enumerate(ladder):
            scale = f"scale=-2:{size}" if w >= h else f"scale={size}:-2"
            ow, oh = (round(w * size / h / 2) * 2, size) if w >= h else (size, round(h * size / w / 2) * 2)
            name = f"{size}p"
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", local,
                   "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
                   "-pix_fmt", "yuv420p", "-b:v", f"{vk}k", "-maxrate", f"{int(vk*1.2)}k",
                   "-bufsize", f"{vk*2}k", "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
                   "-r", "24"]
            cmd += ["-c:a", "aac", "-b:a", f"{ak}k", "-ac", "2"] if has_audio else ["-an"]
            cmd += ["-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
                    "-hls_segment_filename", os.path.join(out, f"{name}_%04d.ts"), os.path.join(out, f"{name}.m3u8")]
            print(f"[transcoder] {tid}: gerando {name}")
            step(tid, f"gerando {name} ({idx + 1} de {len(ladder)})", 5 + int(75 * idx / len(ladder)))
            subprocess.run(cmd, check=True, timeout=3600)
            bw = (vk + (ak if has_audio else 0)) * 1000
            master += [f"#EXT-X-STREAM-INF:BANDWIDTH={int(bw*1.1)},RESOLUTION={ow}x{oh}", f"{name}.m3u8"]
        with open(os.path.join(out, "master.m3u8"), "w") as f:
            f.write("\n".join(master) + "\n")

        prefix = f"tutorials/hls/{tid}/{int(time.time())}"
        files = sorted(os.listdir(out))
        for i, fn in enumerate(files):
            if i % 10 == 0:
                step(tid, f"enviando arquivos ({i} de {len(files)})", 80 + int(19 * i / len(files)))
            ctype = "application/vnd.apple.mpegurl" if fn.endswith(".m3u8") else "video/mp2t"
            with open(os.path.join(out, fn), "rb") as f:
                storage("POST", f"object/{BUCKET}/{prefix}/{urllib.parse.quote(fn)}", f.read(), ctype)
        hls_url = f"{public_base}{MARK}{BUCKET}/{prefix}/master.m3u8"
        sql(f"""UPDATE public.sales_tutorials SET hls_url={lit(hls_url)}, transcode_status='ready',
                transcoded_at=now(), transcode_error=NULL, transcode_step='pronto', transcode_progress=100 WHERE id={lit(tid)} AND video_url={lit(src)};""")
        print(f"[transcoder] {tid}: pronto ({len(files)} arquivos, {', '.join(f'{l[0]}p' for l in ladder)})")
        old = job.get("hls_url") or ""
        if MARK in old:
            old_prefix = old.split(MARK, 1)[1].split("/", 1)[1].rsplit("/", 1)[0]
            if old_prefix != prefix:
                remove_prefix(old_prefix)
        return 0
    except Exception as e:
        msg = str(e)[:400]
        print(f"[transcoder] {tid}: ERRO {msg}")
        try:
            sql(f"UPDATE public.sales_tutorials SET transcode_status='error', transcode_error={lit(msg)}, transcode_step='erro' WHERE id={lit(tid)};")
        except Exception:
            pass
        return 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
