# deleteX: 免费批量删除 X (Twitter) 发帖、转发、引用与回复系统设计方案

> **文档版本**: 1.0.0  
> **设计日期**: 2026-10-07  
> **作者**: Antigravity  
> **目标**: 构建一套零成本、高安全性、保护隐私、支持全量历史清理的 X (Twitter) 批量删除系统。

---

## 一、 项目背景与核心痛点

### 1.1 现状与痛点
1. **官方 API 商业化与高额收费**：
   - X (Twitter) 官方在 API v2 调整后，取消了免费的批量写入/删除能力，现已进入按量计费模式（单条 `DELETE /2/tweets/:id` 计费约 \$0.01 美元）。若用户有 10,000 条推文，仅 API 调用费用即需 \$100 美元。
2. **官方 API 的 3,200 条检索黑洞**：
   - 官方开放接口（`GET /2/users/:id/tweets`）最多只能获取用户时间线最近的 **3,200 条** 推文。对于注册多年、活跃度高的用户，早期的发帖、转推、回复在官方在线接口中完全不可见，无法通过常规在线拉取实施清理。
3. **第三方付费清理服务的隐私风险与费用陷阱**：
   - 市面上的 TweetDeleter、Redact 等工具通常采用月费/年费订阅制（\$10~\$30/月），且需要用户授予完整的 Twitter OAuth 账号写入权限，甚至要求上传个人的 Archive 数据包至其服务器，存在严重的隐私泄露与账号劫持隐患。

### 1.2 系统目标
- **0 成本（Zero Cost）**：不使用官方付费开发者 API，不产生任何账单。
- **支持全量推文分类清理**：精准识别并支持独立/组合筛选清理 **原创发帖（Posts）**、**转推/转发（Retweets）**、**引用发帖（Quotes）**、**回复（Replies）**。
- **突破 3,200 条限制**：基于 X 官方数据归档（Twitter Archive）本地解析，覆盖自建号以来的 100% 历史数据。
- **100% 隐私安全与本地运行**：代码完全开源，所有数据解析、Cookie 读取和网络请求均在用户本地浏览器中运行，绝无任何数据外发第三方服务器。
- **高阶风控防封策略**：模拟真实人类行为节奏，动态抖动延时，批次滑动窗口保护，自动处理 HTTP 429 限流退避。

---

## 二、 关键技术逆向与可行性分析

### 2.1 官方 API vs 网页端内部 GraphQL API 对比

| 维度 | 官方开放 API (v2) | 网页端内部 GraphQL API (Web Client) |
| :--- | :--- | :--- |
| **调用费用** | 收费（单条删除约 \$0.01） | **完全免费**（随用户网页使用） |
| **凭证机制** | OAuth 2.0 / 开发者 Token | 浏览器原生 Session（`auth_token`, `ct0`） |
| **可获取上限** | 最多回溯 3,200 条 | 结合 Archive 可处理 **100% 全量** |
| **反爬风控** | 官方开发者风控规则 | 需通过 CSRF 及浏览器指纹校验（建议浏览器端原生发包） |
| **稳定性** | 接口结构稳定 | `queryId` 随 Web 端发版动态变化（需动态嗅探） |

### 2.2 四大类型推文的数据特征（基于 `tweets.js` 归档）

在 X 归档包解压后的 `data/tweets.js` 文件中，每条记录的对象结构遵循如下规则：

```javascript
// window.YTD.tweets.part0 = [ { "tweet": { ... } } ]
```

1. **转发 / 转推 (Retweet / Repost)**：
   - **判定依据**：
     - `tweet.full_text.startsWith("RT @")` 为 `true`
     - 或包含 `retweeted_status_id` / `retweeted_status_result`
   - **删除机理**：**与普通推文不同！**
     - 接口名称：`DeleteRetweet`
     - 关键参数：**必须传入被转发原推文的 ID (`source_tweet_id`)**，而非自己账号下的转发 ID！
     - 若传入自己的转发 ID 调用 `DeleteTweet` 会返回错误。

2. **回复 (Reply)**：
   - **判定依据**：
     - `tweet.in_reply_to_status_id_str` 不为空（或 `tweet.in_reply_to_user_id_str` 不为空）。
   - **删除机理**：
     - 接口名称：`DeleteTweet`
     - 关键参数：传入当前回复推文自身的 `tweet_id`。

3. **引用发帖 (Quote Tweet)**：
   - **判定依据**：
     - 含有 `quoted_status_id_str` 或 `quoted_status_permalink`，且非以 `RT @` 开头的普通转发。
   - **删除机理**：
     - 接口名称：`DeleteTweet`
     - 关键参数：传入当前引用推文自身的 `tweet_id`。

4. **原创发帖 (Original Post / Tweet)**：
   - **判定依据**：
     - 排除上述三种情况：非以 `RT @` 开头，`in_reply_to_status_id_str` 为空，`quoted_status_id_str` 为空。
   - **删除机理**：
     - 接口名称：`DeleteTweet`
     - 关键参数：传入当前推文自身的 `tweet_id`。

### 2.3 Web 内部 GraphQL 接口协议解构

#### 1) 身份认证与必选请求头
当在 `x.com` 域名下发出请求时，需具备以下 Headers：
- `authorization`: `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA` (X 官方 Web 客户端通用公共 Bearer Token)
- `x-csrf-token`: 等于 Cookie 中的 `ct0` 字段值
- `x-twitter-active-user`: `yes`
- `x-twitter-auth-type`: `OAuth2Session`
- `content-type`: `application/json`
- `cookie`: 包含有效的 `auth_token` 与 `ct0`

#### 2) 删除推文（原创/回复/引用）接口
- **URL**: `POST https://x.com/i/api/graphql/{queryId_DeleteTweet}/DeleteTweet`
- **Body**:
```json
{
  "variables": {
    "tweet_id": "1840000000000000000",
    "dark_request": false
  },
  "queryId": "{queryId_DeleteTweet}"
}
```
- **成功响应**:
```json
{
  "data": {
    "delete_tweet": {
      "tweet_results": {}
    }
  }
}
```

#### 3) 删除转发 / 取消转推（Unretweet）接口
- **URL**: `POST https://x.com/i/api/graphql/{queryId_DeleteRetweet}/DeleteRetweet`
- **Body**:
```json
{
  "variables": {
    "source_tweet_id": "1839000000000000000"
  },
  "queryId": "{queryId_DeleteRetweet}"
}
```
- **成功响应**:
```json
{
  "data": {
    "unretweet": {
      "source_tweet_results": {}
    }
  }
}
```

#### 4) 动态 `queryId` 的解构与应对策略
X 官方前端使用 Webpack 进行打包混淆，`queryId` 会定期随着前端静态资源更新而变动。
- **方案 A（网络拦截嗅探，最优雅）**：在浏览器扩展或油猴脚本中，监听页面自身的 `fetch` / `XMLHttpRequest` 请求，一旦用户在网页上进行一次操作（或页面加载时），自动提取已注册的 Operation Name 对应的 QueryId。
- **方案 B（静态 JS 解析）**：从 X 网页的 `main.[hash].js` 等 bundle 文件中通过正则匹配提取：
  `/\{queryId:"([a-zA-Z0-9_-]+)",operationName:"(DeleteTweet|DeleteRetweet)"\}/g`
- **方案 C（默认内置 + 远程/用户手动更新）**：维护一个已知的当前最新 QueryId 列表，并在控制台中提供用户一键抓取填入的能力。

---

## 三、 系统整体架构设计

### 3.1 总体架构图

```mermaid
flowchart TD
    subgraph DataInput ["1. 数据输入层 (Data Ingestion)"]
        Archive["X 官方数据包 (Twitter Archive)<br/>tweets.js / zip"]
        LiveScan["(可选) 在线时间线快速扫描<br/>UserTweets / UserReplies"]
    end

    subgraph CoreParser ["2. 解析与筛选引擎 (Parser & Filter Core)"]
        Parser["数据流式解析器 (Stream Parser)<br/>提取 window.YTD.tweets.part0"]
        Classifier["推文分类器 (Classifier)<br/>发帖 | 转发 | 引用 | 回复"]
        Filter["多维规则过滤器 (Filter Pipeline)<br/>时间范围 / 关键字 / 互动量保留"]
    end

    subgraph StateStorage ["3. 本地持久化与状态机 (State Machine)"]
        IDB[(IndexedDB 本地数据库)]
        TaskQueue["待删除任务队列 (Task Queue)"]
        LogStore["执行日志与备份快照 (Audit Log)"]
    end

    subgraph ExecutionEngine ["4. 智能调度与执行引擎 (Execution Engine)"]
        RateLimiter["自适应流控器 (Rate Limiter)<br/>2~5s 随机抖动 + 滑动窗口休眠"]
        Sniffer["端点与 QueryId 动态探测器"]
        Executor["双驱动删除执行器<br/>Driver 1: GraphQL 原生 Fetch<br/>Driver 2: DOM 模拟点击兜底"]
        CircuitBreaker["429/403 熔断器 (Backoff Circuit)"]
    end

    subgraph UILayer ["5. 用户交互与展现层 (UI / Extension)"]
        Dashboard["控制面板: 统计卡片 / 进度条"]
        PreviewTable["待删除列表预览 & 白名单保护"]
        ExportBackup["一键导出备份 (CSV/JSON)"]
    end

    Archive --> Parser
    LiveScan --> Classifier
    Parser --> Classifier
    Classifier --> Filter
    Filter --> TaskQueue
    TaskQueue --> IDB
    IDB <--> ExecutionEngine
    Sniffer --> Executor
    RateLimiter --> Executor
    CircuitBreaker --> RateLimiter
    Executor --> UILayer
    UILayer --> TaskQueue
    UILayer --> ExportBackup
```

### 3.2 交付形态选型（推荐双模架构）

为满足不同使用习惯的用户，系统设计为 **“核心内核（Core Engine）”** 驱动的两套交互前端：
1. **主要形态：Chrome / Edge 浏览器扩展 (Manifest V3)**
   - **优势**：
     - 独立运行在扩展 Background Service Worker 与 SidePanel / Popup 中。
     - 原生跨域权限，安全读取当前 `x.com` 标签页的 Cookie（`auth_token`, `ct0`）。
     - 支持后台长时间静默运行，支持大文件切片读取，支持 IndexedDB 离线存储。
2. **辅助形态：Tampermonkey 油猴脚本 / 单文件控制台注入器**
   - **优势**：
     - 零环境配置，直接在 `x.com` 页面内通过油猴安装或 F12 Console 粘贴。
     - 适合轻量级、临时清理需求。

---

## 四、 详细模块设计与实现规范

### 4.1 模块一：归档数据解析与分类器 (Archive Parser & Classifier)

#### 1) 大文件流式解析
许多老用户的 `tweets.js` 高达数十兆甚至数百兆（包含数万条推文）。直接加载容易导致页面内存崩溃。
- **加载策略**：
  - 支持直接选择 `.zip` 文件（使用 JSZip 流式解压 `data/tweets.js`），或让用户直接选择解压出来的 `tweets.js` 文件。
  - 使用正则表达式或前缀剥离：去掉开头的 `window.YTD.tweets.part0 = `，将后续内容作为标准 JSON 数组进行解析。
  - 对超大文件（> 50,000 条），使用 Web Worker 分批切片（Chunking 1000条/批）处理并写入 IndexedDB。

#### 2) 分类器逻辑（TypeScript 伪代码）

```typescript
export enum TweetCategory {
  ORIGINAL = 'original', // 原创发帖
  RETWEET = 'retweet',   // 转发
  QUOTE = 'quote',       // 引用
  REPLY = 'reply'        // 回复
}

export interface NormalizedTweet {
  id: string;                         // 自身推文 ID
  category: TweetCategory;           // 推文分类
  createdAt: Date;                   // 发推时间
  text: string;                      // 文本内容
  favoriteCount: number;             // 点赞数
  retweetCount: number;              // 转发数
  sourceTweetId?: string;            // 若为转发，原推文 ID（必选）
  inReplyToStatusId?: string;        // 若为回复，目标推文 ID
  quotedStatusId?: string;           // 若为引用，被引用推文 ID
}

export function classifyTweet(raw: any): NormalizedTweet {
  const t = raw.tweet || raw;
  const id = t.id_str || t.id;
  const text = t.full_text || t.text || '';
  const createdAt = new Date(t.created_at);
  const favoriteCount = parseInt(t.favorite_count || '0', 10);
  const retweetCount = parseInt(t.retweet_count || '0', 10);

  // 1. 判定转发 (Retweet)
  if (text.startsWith('RT @') || t.retweeted_status_id_str || t.retweeted_status_id) {
    // 提取原推 ID
    let sourceId = t.retweeted_status_id_str || t.retweeted_status_id;
    if (!sourceId && t.entities && t.entities.urls) {
      // 兼容部分未记录原推 ID 的归档版本，从 URL 实体中提取
      const statusUrl = t.entities.urls.find((u: any) => u.expanded_url?.includes('/status/'));
      if (statusUrl) {
        const match = statusUrl.expanded_url.match(/\/status\/(\d+)/);
        if (match) sourceId = match[1];
      }
    }
    return {
      id,
      category: TweetCategory.RETWEET,
      createdAt,
      text,
      favoriteCount,
      retweetCount,
      sourceTweetId: sourceId
    };
  }

  // 2. 判定回复 (Reply)
  if (t.in_reply_to_status_id_str || t.in_reply_to_status_id) {
    return {
      id,
      category: TweetCategory.REPLY,
      createdAt,
      text,
      favoriteCount,
      retweetCount,
      inReplyToStatusId: t.in_reply_to_status_id_str || t.in_reply_to_status_id
    };
  }

  // 3. 判定引用 (Quote)
  if (t.quoted_status_id_str || t.quoted_status_id || (t.entities && t.entities.urls?.some((u: any) => u.expanded_url?.includes('/status/')))) {
    return {
      id,
      category: TweetCategory.QUOTE,
      createdAt,
      text,
      favoriteCount,
      retweetCount,
      quotedStatusId: t.quoted_status_id_str || t.quoted_status_id
    };
  }

  // 4. 原创发帖 (Original)
  return {
    id,
    category: TweetCategory.ORIGINAL,
    createdAt,
    text,
    favoriteCount,
    retweetCount
  };
}
```

#### 3) 多维过滤器配置
用户可在 UI 上配置精细过滤条件：
- **分类复选框**：
  - [x] 删除 原创发帖
  - [x] 删除 转发
  - [x] 删除 引用
  - [x] 删除 回复
- **时间范围过滤器**：
  - 起止时间（例如：仅删除 `2020-01-01` 至 `2023-12-31` 之间的内容）
  - 相对时间（例如：仅删除 `180 天前` 的内容）
- **高赞 / 高转保留阈值（保护精华内容）**：
  - 示例：`点赞数 >= 100` 或 `转发数 >= 50` 的推文自动排除，不删除。
- **关键词白名单 / 黑名单**：
  - 包含特定词（如 `#Important` 或保留特定纪念事件）的内容免于删除。
- **媒体类型**：
  - 仅删含图文 / 仅删纯文本。

---

### 4.2 模块二：删除执行器与 GraphQL 客户端 (Deletion Dispatcher)

#### 1) 会话凭证提取器
运行在 Chrome 扩展环境时：
```javascript
async function getTwitterAuthSession() {
  const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
  const authToken = cookies.find(c => c.name === 'auth_token')?.value;
  const ct0 = cookies.find(c => c.name === 'ct0')?.value;

  if (!authToken || !ct0) {
    throw new Error('未检测到有效的 x.com 登录凭据，请先在浏览器中登录 X (Twitter)');
  }

  return {
    authToken,
    ct0,
    bearerToken: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
  };
}
```

#### 2) GraphQL 执行核心（DeleteTweet 与 DeleteRetweet）
```javascript
class XDeletionClient {
  constructor(session, queryIds) {
    this.session = session;
    this.queryIds = queryIds; // { DeleteTweet: '...', DeleteRetweet: '...' }
  }

  getHeaders() {
    return {
      'authorization': this.session.bearerToken,
      'x-csrf-token': this.session.ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json'
    };
  }

  // 删除发帖 / 回复 / 引用
  async deleteTweet(tweetId) {
    const queryId = this.queryIds.DeleteTweet;
    const url = `https://x.com/i/api/graphql/${queryId}/DeleteTweet`;
    const payload = {
      variables: {
        tweet_id: tweetId,
        dark_request: false
      },
      queryId: queryId
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    return this.handleResponse(res, tweetId);
  }

  // 取消转推 / 删除转发
  async deleteRetweet(sourceTweetId) {
    if (!sourceTweetId) {
      throw new Error('未找到原推文 ID，无法执行 DeleteRetweet');
    }
    const queryId = this.queryIds.DeleteRetweet;
    const url = `https://x.com/i/api/graphql/${queryId}/DeleteRetweet`;
    const payload = {
      variables: {
        source_tweet_id: sourceTweetId
      },
      queryId: queryId
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    return this.handleResponse(res, sourceTweetId);
  }

  async handleResponse(res, targetId) {
    if (res.status === 200) {
      const data = await res.json();
      if (data.errors && data.errors.length > 0) {
        // 部分推文可能已经在 X 端被标记删除或原帖已不可见
        const isAlreadyDeleted = data.errors.some(e => e.message?.toLowerCase().includes('not found') || e.code === 144);
        if (isAlreadyDeleted) {
          return { status: 'already_deleted', id: targetId };
        }
        throw new Error(data.errors.map(e => e.message).join('; '));
      }
      return { status: 'success', id: targetId };
    } else if (res.status === 429) {
      throw new RateLimitError('触发 X 频率限制 (429 Too Many Requests)');
    } else if (res.status === 403) {
      throw new ForbiddenError('请求被拒绝 (403 Forbidden)，请检查 CSRF Token 或账号登录状态');
    } else {
      throw new Error(`HTTP 异常状态码: ${res.status}`);
    }
  }
}
```

---

### 4.3 模块三：流控防封与调度引擎 (Rate Limiting & Safety Engine)

批量删除最核心的技术难点在于 **防封号与应对 X 频率限制**。如果不加控制地高频并发发包，账号极易被临时冻结或直接封禁。

#### 1) 核心流控原则
1. **严格单线程串行执行**：绝对不可使用 `Promise.all` 并发删除，必须单条串行执行。
2. **拟人化随机抖动延时 (Random Jitter)**：
   - 基础间隔：`2,000ms`
   - 抖动范围：`+ random(500ms, 3,000ms)`
   - 每次删除后随机等待 `2.5s ~ 5s`。
3. **滑动窗口批次保护 (Sliding Batch Window)**：
   - X 的常见限流窗口为 **15 分钟**。
   - 每执行 **60 条**（可配置 40~80 条），调度器自动进入“大休眠状态”，强制等待 **15 分钟**（900 秒）。
   - 此机制彻底避开平台异常高频写操作检测，即使清理数万条也能平稳持续运行。
4. **429 指数退避熔断机制 (Exponential Backoff)**：
   - 遇到 HTTP 429 响应时，立即暂停执行。
   - 第一次触发 429：休眠 15 分钟后自动重试。
   - 连续第二次触发 429：休眠 30 分钟。
   - 连续三次：自动终止任务并报警提醒用户。

```mermaid
stateDiagram-v2
    [*] --> Idle: 等待启动
    Idle --> Running: 用户点击“开始清理”
    
    state Running {
        [*] --> FetchNext: 从队列获取下一条待删推文
        FetchNext --> ExecuteDelete: 分发执行 (DeleteTweet / DeleteRetweet)
        ExecuteDelete --> CheckSuccess: 判定执行结果
        
        CheckSuccess --> UpdateProgress: 成功 (更新 IDB 状态)
        UpdateProgress --> SleepJitter: 延时休眠 (2.5s ~ 5s)
        
        SleepJitter --> BatchCheck: 检查累计批次数 (是否达 60 条)
        BatchCheck --> FetchNext: 批次未满
        BatchCheck --> BatchCooling: 批次已满 (进入 15 分钟大休眠)
        BatchCooling --> FetchNext: 休眠结束，重置计数器
        
        CheckSuccess --> Handle429: 触发 429 限流
        Handle429 --> AutoBackoff: 指数退避休眠 (15~30 分钟)
        AutoBackoff --> ExecuteDelete: 自动重试当前推文
    }
    
    Running --> Paused: 用户手动暂停
    Paused --> Running: 用户继续
    Running --> Completed: 队列为空 (所有项目处理完毕)
    Completed --> [*]
```

---

### 4.4 模块四：本地持久化数据库设计 (IndexedDB Schema)

为保证在意外刷新、断网或长时间挂机时不丢失删除进度，使用浏览器原生的 **IndexedDB** 进行持久化。

#### 1) 数据库结构定义
- **Database Name**: `DeleteX_DB` (Version: 1)
- **Object Store: `tweets`**:
  - `keyPath`: `id`
  - 索引字段：
    - `category`: `[ 'original', 'retweet', 'quote', 'reply' ]`
    - `status`: `[ 'pending', 'deleting', 'success', 'failed', 'already_deleted', 'skipped' ]`
    - `createdAt`: 时间戳
    - `batchId`: 导入批次标识
- **Object Store: `config`**:
  - 存储用户的流控配置、过滤规则、已嗅探到的 QueryIds。
- **Object Store: `logs`**:
  - 存储详细操作审计流水（时间戳、推文 ID、类别、简略文本、结果状态）。

---

### 4.5 模块五：交互界面设计与安全兜底 (UI & Safety Guard)

#### 1) 界面功能分区
1. **数据导入区 (Import Section)**：
   - 支持拖拽上传 `tweets.js` 或解压后的归档目录。
   - 导入后即刻展示宏观数据看板：
     - 总推文数：23,450 条
     - 原创发帖：8,210 条 (35%)
     - 转发/转推：9,120 条 (39%)
     - 回复推文：4,890 条 (21%)
     - 引用推文：1,230 条 (5%)
2. **清理条件筛选器 (Filter Panel)**：
   - 四大类型独立勾选项。
   - 时间区间选择器（带快捷选项：“一年前”、“两年前”、“自定义时间段”）。
   - 保护条件：“点赞数大于 N”、“转发数大于 N”、“包含保留标签”。
3. **数据安全与预检 (Dry-Run & Backup)**：
   - **预检模式 (Dry-Run)**：仅跑流程生成拟删除列表，不真正向 X 发送网络请求。
   - **导出备份**：一键导出包含正文与原链接的 `deleteX_backup.csv`，确保用户未来想找回记忆时有档可查。
4. **实时控制台与监控面板 (Live Console)**：
   - 当前进度条（如：已删除 1,240 / 5,600，完成率 22.1%）。
   - 预估剩余时间（基于当前流控速度计算）。
   - 动态日志流展示（绿标：删除成功，黄标：已不存在，红标：重试中）。
   - 大按钮：**[开始清理]** / **[暂停]** / **[停止并重置]**。

---

## 五、 推荐工程架构与代码组织

```
deleteX/
├── docs/
│   └── superpowers/specs/2026-10-07-deletex-architecture-design.md # 本设计文档
├── extension/                           # Chrome 扩展源码 (MV3)
│   ├── manifest.json                    # 扩展清单配置
│   ├── background/
│   │   ├── service-worker.js            # 后台常驻服务与请求嗅探
│   │   └── query-sniffer.js             # 自动捕获 x.com 的 DeleteTweet QueryId
│   ├── content/
│   │   └── content-script.js            # 注入 x.com 页面脚本（DOM 辅助与会话桥接）
│   ├── popup/
│   │   ├── popup.html                   # 扩展弹出界面
│   │   ├── popup.js                     # 快捷控制
│   │   └── popup.css
│   ├── dashboard/                       # 核心操作大屏（独立全屏 Tab 页面）
│   │   ├── index.html                   # 主界面仪表盘
│   │   ├── app.js                       # 界面交互绑定
│   │   ├── style.css                    # 现代暗色系 UI 样式
│   │   ├── parser.js                    # tweets.js 流式解析器与分类器
│   │   ├── client.js                    # GraphQL 调用驱动
│   │   ├── engine.js                    # 队列调度、抖动流控与限流熔断引擎
│   │   └── storage.js                   # IndexedDB 封装
│   └── icons/                           # 插件图标资源
├── userscript/                          # (备选) 单文件油猴脚本
│   └── deletex.user.js                  # 零配置 Tampermonkey 脚本
└── README.md                            # 项目使用说明与安全注意事项
```

---

## 六、 实施路线图 (Implementation Roadmap)

1. **第一阶段：核心协议与解析引擎打通**
   - 编写 `parser.js`：解析 `tweets.js`，精准分离发帖、转推、引用、回复 4 类数据。
   - 编写 `client.js`：实现 `DeleteTweet` 与 `DeleteRetweet` 的 GraphQL 封装，支持传递动态 QueryId。
2. **第二阶段：流控与持久化调度器开发**
   - 编写 `storage.js`：完成 IndexedDB 数据存取与断点恢复逻辑。
   - 编写 `engine.js`：实现带 Jitter（2~5s）和 15 分钟滑动窗口的串行调度器与 429 退避逻辑。
3. **第三阶段：UI 界面与 Chrome 扩展封装**
   - 制作 Dashboard 界面：图表展示分类占比、多维条件筛选器、数据导出。
   - 封装为 Chrome Extension MV3，支持后台稳定运行。
4. **第四阶段：实测与降级兜底验证**
   - 测试不同年份历史归档文件的兼容性。
   - 验证异常状态码（429、403、推文已预先删除）的处理健壮性。

---

## 七、 总结

通过上述架构设计：
1. **彻底攻克费用问题**：避开收费的官方 API v2，采用与用户网页操作完全等价的 Web 内部 GraphQL 协议，**实现 100% 免费**。
2. **彻底攻克 3200 条限制**：基于 X 官方 Archive 数据包，获取账号创设以来的 **100% 完整推文历史**。
3. **精准处理四大分类**：特别针对“转发”需要调用 `DeleteRetweet(source_tweet_id)` 与“原创/引用/回复”调用 `DeleteTweet(tweet_id)` 的技术细节进行了精确分流处理。
4. **极高安全性**：纯浏览器前端本地运行，无后端服务，不外发 Cookie，自带拟人化随机流控与滑动窗口熔断，最大限度保障账号安全。
