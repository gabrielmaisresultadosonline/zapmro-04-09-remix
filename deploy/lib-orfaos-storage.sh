#!/usr/bin/env bash
# lib-orfaos-storage.sh — conferência ÚNICA de arquivos órfãos do storage.
# Usada por limpar-arquivos-orfaos.sh, limpar-armazenamento.sh e
# manutencao-armazenamento-vps.sh (antes cada um tinha a sua, e todas erravam).
#
# Layout real do backend "file" (docker-compose: GLOBAL_S3_BUCKET e TENANT_ID):
#   /var/lib/storage/<GLOBAL_S3_BUCKET>/<TENANT_ID>/<bucket>/<nome...>/<versão>
# Ex.: zapmro/zapmro/crm-media/incoming/foto_m123.jpg/2f1c...-uuid
#
# Regras de segurança:
#  - só avalia caminhos com esse formato exato; qualquer outra coisa é mantida;
#  - arquivo com bucket+nome no banco é mantido (versão igual, versão vazia
#    no banco ou layout antigo sem versão);
#  - só é "versao-antiga" quando o banco tem OUTRA versão do mesmo nome;
#  - se os órfãos passarem de 40% dos arquivos, a exclusão é recusada.

ORF_GLOBAL="${GLOBAL_S3_BUCKET:-zapmro}"
ORF_TENANT="${TENANT_ID:-zapmro}"
ORF_MAX_PCT="${ORF_MAX_PCT:-40}"

# orf_coletar <dir_trabalho> <idade_min> <db_cont> <st_cont> <db_name>
# Gera <dir>/db.tsv, <dir>/disk.tsv e <dir>/orfaos.tsv (tamanho, caminho, motivo).
orf_coletar() {
  local w="$1" idade="$2" dbc="$3" stc="$4" dbn="${5:-postgres}"
  mkdir -p "$w"
  docker exec -i "$dbc" psql -U postgres -d "$dbn" -At -F $'\t' \
    -c "select bucket_id, name, coalesce(version,'') from storage.objects" > "$w/db.tsv" || return 1
  docker exec "$stc" sh -c "cd /var/lib/storage && find . -type f -mmin +$idade -printf '%s\t%P\n'" > "$w/disk.tsv" 2>/dev/null \
    || docker exec "$stc" sh -c "cd /var/lib/storage && find . -type f -mmin +$idade -exec stat -c '%s	%n' {} \;" | sed 's#\t\./#\t#' > "$w/disk.tsv" \
    || return 1
  awk -F'\t' -v G="$ORF_GLOBAL" -v T="$ORF_TENANT" '
    NR==FNR { k=$1 "\t" $2; has[k]=1; if ($3=="") nover[k]=1; else ver[k "\t" $3]=1; next }
    {
      size=$1; rel=$2; n=split(rel, p, "/");
      if (n < 4 || p[1] != G || p[2] != T) next;          # formato desconhecido: mantém
      if (rel ~ /\.metadata$/ || rel ~ /\/\.[^\/]*$/) next; # auxiliares: mantém
      bucket=p[3];
      full=""; for (i=4;i<=n;i++) full = full (full==""?"":"/") p[i];
      if ((bucket "\t" full) in has) next;                 # layout sem versão
      if (n < 5) { print size "\t" rel "\tsem-registro"; next }
      name=""; for (i=4;i<n;i++) name = name (name==""?"":"/") p[i];
      k=bucket "\t" name;
      if (!(k in has)) { print size "\t" rel "\tsem-registro"; next }
      if ((k in nover) || ((k "\t" p[n]) in ver)) next;     # versão atual
      print size "\t" rel "\tversao-antiga";
    }' "$w/db.tsv" "$w/disk.tsv" > "$w/orfaos.tsv"
}

orf_bytes() { awk -F'\t' '{s+=$1} END {printf "%d", s+0}' "$1/orfaos.tsv"; }

# orf_seguro <dir>: 0 se a proporção de órfãos é plausível para apagar.
orf_seguro() {
  local total orf
  total=$(wc -l < "$1/disk.tsv"); orf=$(wc -l < "$1/orfaos.tsv")
  [ "$total" -gt 0 ] || return 1
  [ $((orf * 100 / total)) -le "$ORF_MAX_PCT" ]
}

# orf_apagar <dir> <st_cont>: apaga numa única chamada dentro do container.
orf_apagar() {
  cut -f2 "$1/orfaos.tsv" | docker exec -i "$2" sh -c \
    'cd /var/lib/storage && while IFS= read -r f; do [ -n "$f" ] && rm -f -- "$f"; done; find . -mindepth 3 -type d -empty -delete 2>/dev/null; true'
}
