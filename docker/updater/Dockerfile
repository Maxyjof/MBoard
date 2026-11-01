# 更新容器镜像：docker CLI 与 compose 插件来自基础镜像，再补 node 与 git
# 它的职责只有一件事：按 /spool 里的请求重建 mboard 服务，所以只暴露 docker.sock 与项目根
FROM docker:27-cli

ENV TZ=Asia/Shanghai

# alpine 换清华源后再装包，nodejs 用于跑主程序，git 用于拉代码
# ca-certificates 已在基础镜像内，这里显式列出来避免基础镜像变动后 https 拉取失败
RUN sed -i 's|dl-cdn.alpinelinux.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apk/repositories \
    && apk add --no-cache nodejs git ca-certificates tzdata \
    && rm -rf /var/cache/apk/*

WORKDIR /opt/updater

# 主程序与入口脚本单独搬进来，镜像层缓存友好
COPY docker/updater/updater.mjs /opt/updater/updater.mjs
COPY docker/updater/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
