---
title: "逆向 Kimi 网页端：从抓包到协议复现"
date: 2026-05-17
description: "拆解 kimi2api 项目，讲清楚 Kimi 网页端 gRPC-Web 协议的逆向过程：协议发现、请求构造、Token 鉴权、流式响应解析。"
categories:
  - 逆向
draft: false
---

## 1. 这是什么

[kimi2api](https://github.com/chopper1026/kimi2api) 是一个把 Kimi 网页端聊天能力包装成 OpenAI 兼容 API 的服务。

它的做法很直接：**逆向 Kimi 网页端的通信协议，用 Python 复现浏览器的请求**，然后把 Kimi 的私有协议翻译成 `/v1/chat/completions`。

这篇文章不讲项目架构，只讲一件事：**Kimi 网页端的协议是怎么被逆向出来的**。

## 2. 抓包：发现 gRPC-Web

打开 Chrome DevTools → Network，在 Kimi 网页里发一条消息，你会看到：

```text
Request URL: https://www.kimi.com/apiv2/kimi.gateway.chat.v1.ChatService/Chat
Request Method: POST
Content-Type: application/grpc-web+proto
```

两个关键信号：

1. **路径格式** `/apiv2/kimi.gateway.chat.v1.ChatService/Chat` — 这是 gRPC 的标准路径命名：`/package.service/method`
2. **Content-Type** `application/grpc-web+proto` — 这是 gRPC-Web 协议

gRPC-Web 是 gRPC 的浏览器友好版本。Google 设计它让浏览器可以直接调用 gRPC 后端，不需要 HTTP/2 或者专门的代理。大多数前端 gRPC 框架（比如 grpc-web JS 库）都用这个协议。

## 3. 请求格式：5 字节头 + JSON

gRPC-Web 的请求体不是纯 JSON，也不是标准 protobuf 二进制。它的格式是：

```text
[1 byte flag][4 bytes body length (big-endian)][body bytes]
```

kimi2api 里的实现：

```python
def _encode_connect_request(payload: dict) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    header = bytearray(5)
    header[0] = 0x00                          # 未压缩标志
    header[1:5] = len(body).to_bytes(4, "big") # body 长度
    return bytes(header) + body
```

这里有个有趣的地方：**body 是 JSON 而不是 protobuf**。

标准 gRPC 用 protobuf 序列化，但 Kimi 的 gRPC-Web 端点直接接受 JSON。这可能是因为前端 JS 库用了 grpc-web 的 `application/grpc-web+json` 模式，或者服务端同时兼容两种格式。不管原因是什么，这让逆向简单了很多——不需要还原 `.proto` 文件。

## 4. 请求体结构

抓包看到的 JSON payload：

```json
{
  "scenario": "SCENARIO_K2D5",
  "tools": [],
  "message": {
    "role": "user",
    "blocks": [
      {
        "message_id": "",
        "text": {
          "content": "user:你好"
        }
      }
    ],
    "scenario": "SCENARIO_K2D5"
  },
  "options": {
    "thinking": false
  }
}
```

关键字段：

| 字段 | 含义 |
|------|------|
| `scenario` | 模型场景标识，`SCENARIO_K2D5` 是默认的 Kimi 对话场景 |
| `tools` | 工具调用，搜索是 `{"type": "TOOL_TYPE_SEARCH", "search": {}}` |
| `message.blocks[].text.content` | 消息内容 |
| `options.thinking` | 是否开启思考模式 |

**多轮对话**的处理方式很粗暴：把所有历史消息拼成一个字符串：

```python
def _format_messages(messages):
    # 把 OpenAI 风格的 messages 数组拼成：
    # "system:你是一个助手\nuser:你好\nassistant:你好！\nuser:今天天气怎么样"
    lines = []
    for msg in messages:
        role = msg.role
        content = msg.content
        lines.append(f"{role}:{content}")
    return "\n".join(lines)
```

如果有 `chat_id`（已有会话）和 `parent_id`（上一条消息 ID），就附到 payload 里：

```python
if context.remote_chat_id:
    payload["chat_id"] = context.remote_chat_id
if context.last_assistant_message_id:
    message["parent_id"] = context.last_assistant_message_id
```

## 5. 必须伪造的 Headers

Kimi 服务端会检查请求头，必须模拟浏览器的完整指纹：

```python
FAKE_HEADERS = {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Origin": "https://www.kimi.com",
    "R-Timezone": "Asia/Shanghai",
    "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
    "Priority": "u=1, i",
    "X-Msh-Platform": "web",
}
```

加上认证头：

```python
headers["Authorization"] = f"Bearer {access_token}"
```

这些 headers 全部是从 Chrome DevTools 里直接复制的。服务端不验证它们是否真的来自浏览器——只要格式对就行。

## 6. Token：从 Cookie 到鉴权

### 6.1 拿 Token

登录 kimi.com，F12 → Application → Cookies：

```text
refresh_token = cpmt_xxxxx...   # 长期有效
access_token  = eyJhbGciOi...   # JWT，短期有效
```

### 6.2 Token 类型检测

```python
def detect_token_type(token: str) -> str:
    if token.startswith("eyJ") and len(token.split(".")) == 3:
        return "access"   # JWT 格式
    return "refresh"      # 其他都是 refresh token
```

JWT 以 `eyJ` 开头（base64 编码的 `{"`），有三段用 `.` 分隔。refresh token 是 Kimi 自己的格式，以 `cpmt_` 开头。

### 6.3 刷新 Token

access token 过期后，用 refresh token 换新的：

```python
KIMI_REFRESH_PATH = "/api/auth/token/refresh"

# 发送 refresh 请求
resp = await transport.request(
    "POST",
    KIMI_REFRESH_PATH,
    headers={"Authorization": f"Bearer {refresh_token}"},
)
# 返回新的 access_token
```

kimi2api 的 `TokenManager` 会自动处理这个过程：检测过期、自动刷新、缓存到本地文件、重启后复用。

### 6.4 为什么 Token 能直接用

因为 JWT 是**无状态**的。

服务端不存 Token，只验证签名：

```text
1. 收到 Token
2. 用 secret_key 重新算签名
3. 签名一致 → 有效
4. 检查 exp 字段 → 没过期
```

服务端看到的只是"一个有效 Token 的请求"，不知道也不关心这个请求是浏览器发的还是 Python 脚本发的。

Kimi 没有做以下防护：
- **设备绑定**：device_id 是随机生成的，服务端不校验
- **IP 绑定**：换 IP 也能用同一个 Token
- **请求签名**：没有 timestamp/nonce 验证
- **浏览器环境检测**：不跑 JS 挑战

## 7. 响应解析：SSE 事件流

Kimi 的响应是 **Server-Sent Events (SSE)** 格式：

```text
data: {"chat":{"id":"chat_xxx"},"message":{"id":"msg_xxx"}}

data: {"message":{"content":"你"}}

data: {"message":{"content":"好"}}

data: {"block":{"multiStage":{"stages":[{"name":"STAGE_NAME_THINKING","content":"让我想想..."}]}}}

data: {"message":{"status":"FINISHED"}}
```

kimi2api 的解析逻辑：

```python
async def iter_grpc_events(response):
    buffer = bytearray()
    async for chunk in response.aiter_bytes():
        buffer.extend(chunk)
        while (idx := buffer.find(b"\n")) != -1:
            line = buffer[:idx]
            buffer = buffer[idx + 1:]
            if line.startswith(b"data: "):
                yield json.loads(line[6:])
```

事件类型：

| 事件 | 含义 |
|------|------|
| `chat.id` 出现 | 会话创建，记录 chat_id |
| `message.id` 出现 | 消息创建，记录 parent_id |
| `message.content` | 文本增量 |
| `block.multiStage.stages` | thinking 内容 |
| `block.toolCall` | 搜索等工具调用 |
| `message.status == "FINISHED"` | 回复结束 |

然后翻译成 OpenAI 的 chunk 格式：

```text
Kimi: data: {"message":{"content":"你"}}
  ↓
OpenAI: data: {"choices":[{"delta":{"content":"你"}}],"object":"chat.completion.chunk"}
```

## 8. 设备 ID 和会话 ID

Kimi 还需要两个随机 ID：

```python
def generate_device_id() -> str:
    return str(random.randint(7000000000000000000, 7999999999999999999))

def generate_session_id() -> str:
    return str(random.randint(1700000000000000000, 1799999999999999999))
```

device_id 会持久化到本地文件 `data/kimi_client_identity.json`，这样重启后不会变。服务端用这个 ID 做限流统计，但不做设备绑定验证。

## 9. 完整请求流程

```text
1. 从浏览器 Cookie 拿到 refresh_token
2. 用 refresh_token 换 access_token
3. 构造 JSON payload（scenario + message + options）
4. JSON → gRPC-Web 二进制格式（5字节头 + body）
5. 附上伪造的浏览器 headers + Bearer token
6. POST → /apiv2/kimi.gateway.chat.v1.ChatService/Chat
7. 解析 SSE 响应流
8. 翻译成 OpenAI chunk 格式
```

## 10. 为什么能逆向成功

本质上是因为 **Web 端无法做到真正的安全**。

浏览器里的所有东西——JS 代码、网络请求、Cookie、Headers——用户都能看到。任何在浏览器里跑的协议，都等于公开了。区别只在于复现的难度：

- **Kimi**：gRPC-Web + JSON body + Bearer Token，几乎没有额外防护，逆向成本很低
- **Claude/ChatGPT**：有 Cloudflare Turnstile 挑战、POW（Proof of Work）、请求签名，逆向成本高得多

Kimi 的策略是依赖账号级限流而不是协议级防护。这意味着单账号能被限流，但用账号池就能绕过——这也正是 kimi2api 的做法。
