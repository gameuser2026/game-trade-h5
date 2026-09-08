# 零依赖 Node.js 镜像
FROM node:20-alpine

# 安装 tzdata 用于时区
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai

# 工作目录
WORKDIR /app

# 复制项目文件（.dockerignore 会过滤掉 node.exe / cloudflared.exe 等 Windows 专属文件）
COPY . .

# 创建持久化目录（运行时挂载卷覆盖）
RUN mkdir -p /app/uploads /app/keys

# 数据目录（data.json 在卷中）
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

# 暴露端口（Fly 会自动映射到公网）
EXPOSE 3000

# 启动服务
CMD ["node", "server.js"]
