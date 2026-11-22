#!/usr/bin/env bash
# THROWAWAY (never merged): which sites answer from the international Studio runner (sham-runner-1)?
for h in example.com www.google.com www.youtube.com github.com api.github.com raw.githubusercontent.com cn.bing.com www.bing.com www.baidu.com duckduckgo.com en.wikipedia.org pypi.org registry.npmjs.org huggingface.co hf-mirror.com modelscope.cn modelscope.ai api.telegram.org workers.dev vercel.app cloudflare.com; do
  ( r=$(curl -sS -o /dev/null -m 7 -w '%{http_code} %{time_total}' "https://$h/" 2>&1 | tail -1); echo "$h => $r" ) &
done
wait
echo "--- memory / cpu / disk"; free -m | head -2; nproc; df -h /mnt/workspace 2>/dev/null | tail -1; echo "--- tools"; for t in Xvfb xterm openbox pcmanfm chromium chromium-browser google-chrome node python3 git docker; do printf "%s=%s " $t "$(command -v $t || echo no)"; done; echo; id -u; uname -a | cut -c1-80
