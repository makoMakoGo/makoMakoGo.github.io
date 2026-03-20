---
title: Uptime Kuma 部署与配置笔记
date: 2026-03-19
description: 自托管服务监控工具 Uptime Kuma 的部署与配置记录。
categories:
  - 运维
draft: false
---

## 为什么选自托管而不是 SaaS

SaaS 方案（比如 Uptime Robot）注册就能用，确实省心。但问题在于：

- **免费额度通常不大**，监控项多起来以后容易碰到套餐上限
- **数据存在别人服务器上**，监控历史是基础设施的健康档案，长期交给第三方不踏实
- **供应商锁定风险**——服务商涨价、改条款、甚至关停你都没办法

Uptime Kuma 的解法是跑在自己机器上。数据归自己，没有 SaaS 那种按监控项卡配额的门槛，真正的上限主要取决于你的机器资源和部署方式。作者 Louis Lam 当初也是因为找不到一个像 Uptime Robot 那样顺手的自托管替代品，才自己动手做了这个项目。

## 架构笔记

技术栈大致可以理解成：Node.js 后端 + Vue 3 前端 + Vite 构建。对常见 Web 开发栈比较熟的人，上手门槛不高。

### 前后端通信走 WebSocket 而不是 REST

这是 Uptime Kuma 仪表盘看起来比较“实时”的关键。打开页面后，监控状态、响应时间、图表会持续更新，不需要手动刷新。相比轮询，WebSocket 更适合这种状态频繁变化的界面。

代价是反向代理必须正确处理 WebSocket 升级握手。只做普通 HTTP 转发往往不够，Nginx 至少要把下面几行补上：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

不加的话页面能打开，但仪表盘数据不刷新。

### 所有状态都在一个 SQLite 数据库里

路径是容器内的 `/app/data/kuma.db`。监控配置、历史记录、通知渠道、用户账户、状态页——全在这一个文件里。Docker 部署时必须把 `/app/data` 挂载出来，否则容器一重建什么都没了。

官方文档明确建议**不要用 NFS 之类的网络文件系统**挂载数据卷。SQLite 对这类存储的兼容性并不好，踩到的话通常不是“偶尔报错”，而是直接损库。

这也意味着：备份就是打包这个目录，更新就是 pull 新镜像重启容器，数据库跟着走，无缝升级。

## 部署：Docker Compose

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma
    volumes:
      - ./uptime-kuma-data:/app/data
    ports:
      - "3001:3001"
    restart: always
```

逐行记一下：

- `image: louislam/uptime-kuma:2`：截至 2026 年 3 月，v2 稳定标签应优先于 `latest`
- `volumes`：**最关键的一行**，前面说了，挂载数据卷保证持久化
- `ports`：主机 3001 映射到容器 3001
- `restart: always`：容器挂了或服务器重启后自动拉起来，监控服务本身不能挂

```bash
docker compose up -d
```

浏览器 `http://<IP>:3001`，创建管理员账户就能用了。

### 裸机安装（备选）

不想用 Docker 的话也可以直接装。按当前官方文档，至少需要 Node.js `>= 20.4`、npm、Git、pm2：

```bash
git clone https://github.com/louislam/uptime-kuma.git
cd uptime-kuma
npm run setup
npm install pm2 -g && pm2 install pm2-logrotate
pm2 start server/server.js --name uptime-kuma
pm2 save && pm2 startup
```

## 监控类型

监控不是一维的，不同层次回答的是不同问题：

| 层次 | 类型 | 检查的是什么 |
|------|------|-------------|
| 网络层 | Ping (ICMP) | 机器在不在、网络通不通 |
| 传输层 | TCP 端口 | 服务在不在监听（数据库 3306、SSH 22 之类的） |
| 应用层 | HTTP(s) | 请求能不能正常返回、响应时间多少 |
| 内容层 | HTTP(s) 关键字 | 返回的内容对不对 |

**Ping 成功不代表服务正常。** Ping 通了，只能说明机器在网络上可达；上面的应用完全可能已经挂了。所以 Ping 更像最底层的连通性检查，不该拿它代替业务可用性监控。

一般 HTTP(s) 就够用了。关键字检查适合这种场景：页面返回 200 OK，但内容其实是"数据库连接失败"或者网站被黑了——光看状态码发现不了问题。

### HTTP(s) 监控的配置选项

- **心跳间隔**：多久检查一次，最短 20 秒
- **请求方法**：GET、POST、HEAD 等，API 监控可能需要 POST
- **请求体 / Headers**：需要特定参数或认证头的时候用
- **认证方式**：支持 Basic Auth 和 NTLM
- **接受的状态码**：默认 `200-299`，如果服务用重定向就加上 `300-399`
- **SSL 证书检查**：自动检查证书有效期，快到期会告警

### Push（心跳）——被动监控

这个模式和前面的主动探测不一样：Uptime Kuma 会生成一个唯一 URL，等被监控的服务来“报到”。超过设定时间没报到，就按异常处理。

适用场景：
- **Cron Job / 定时任务**：脚本跑完后 curl 一下这个 URL
- **防火墙后面的服务**：只能出站不能入站，外部无法主动探测

### 其他类型

- **DNS 记录**：监控 DNS 解析是否正确，防止 DNS 污染或配置错误
- **Docker 容器**：监控容器运行状态
- **数据库**：直接连 MySQL/PostgreSQL/Redis 查询状态
- **Steam 游戏服务器**：专门监控游戏服务器状态

## 通知配置

通知系统分两层：

1. **全局配置渠道**：设置 → 通知，添加通知服务（Telegram、Discord、Email 等）
2. **监控项关联**：每个监控项单独选要用哪些渠道

这样可以把不同重要性的告警发到不同地方——核心服务故障发 Telegram/短信，次要服务发 Discord 频道。

### Telegram 配置步骤

1. 找 `@BotFather`，发 `/newbot`，按提示设置名称和用户名（必须以 `bot` 结尾）
2. 拿到 API Token，妥善保管
3. 给 Bot 发条消息（私聊或拉群都行）
4. Uptime Kuma 里选 Telegram 类型，填 Token，点"自动获取"Chat ID
5. 测试，能收到就保存

### Discord

更简单：服务器设置 → 整合 → 创建 Webhook，粘 Webhook URL 到 Uptime Kuma。

### Email

需要 SMTP 服务器信息：地址、端口、用户名、密码。适合发正式的邮件通知。

## 反向代理与状态页

如果打算对外暴露，通常不会让用户直接访问 `http://IP:3001`。下面这个 Nginx 配置只是一个**基础反向代理示例**，重点是把 WebSocket 头转发对；真正放到生产环境时，还需要补 HTTPS、证书和站点级安全配置。

```nginx
server {
    listen 80;
    server_name status.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 升级——不加这个仪表盘不会实时刷新
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### 状态页

Uptime Kuma 自带状态页功能，可以创建面向公众的服务状态展示页面：

1. 顶部导航 → 状态页 → 添加新的状态页
2. 设置名称和 URL 路径（slug）
3. 选择要公开展示的监控项

支持自定义 CSS 改外观。配合 HTTPS 反代之后，就可以做成 `https://status.yourdomain.com` 这种公开状态页。

## 日常维护

### 安全：开 2FA

暴露在公网的服务没有理由不开。设置 → 安全 → 2FA 设置，用 Google Authenticator / Authy 扫码，输入两个连续的动态口令完成验证。

### 备份

本质上就是打包数据卷：

```bash
tar -czvf uptime-kuma-backup-$(date +%F).tar.gz ./uptime-kuma-data
```

### 更新

Docker 的优势在这里很直接：数据和容器是分开的，更新流程相对简单：

```bash
docker compose pull
docker compose up -d
```

Docker Compose 会自动用新镜像替换旧容器，数据卷原封不动挂上去。

## 参考来源

- [Uptime Kuma GitHub Repository](https://github.com/louislam/uptime-kuma)
- [Uptime Kuma Install Wiki](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install)
- [Uptime Kuma Docker Tags Wiki](https://github.com/louislam/uptime-kuma/wiki/Docker-Tags)
- [Uptime Kuma Docker Hub](https://hub.docker.com/r/louislam/uptime-kuma)
- [Uptime Kuma Demo](https://demo.kuma.pet)
