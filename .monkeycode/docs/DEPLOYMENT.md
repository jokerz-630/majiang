# 杭州麻将 Web 游戏部署与运维文档

## 1. 项目概览

- 服务名：`hangzhou-mahjong-web-game`
- 当前版本：`0.1.0`
- 运行形态：单进程 Node.js Web 应用
- 默认端口：`5173`
- 前后端关系：同一进程同时提供静态页面、HTTP API 和 WebSocket 房间同步

当前入口文件：

- 服务启动入口：`server.js`
- 服务主实现：`src/server/app.js`
- 静态资源目录：`public/`

## 2. 启动命令

开发和生产当前都使用同一启动方式。

```bash
# 本地开发启动
npm run dev

# 生产启动
npm start
```

如果需要指定端口，使用环境变量 `PORT`。

```bash
# 指定端口启动
PORT=8080 npm start
```

## 3. 环境变量

当前代码中只有一个运行时环境变量：

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `5173` | HTTP 服务监听端口 |

代码来源：`src/server/config.js`

```js
export const port = Number(process.env.PORT || 5173);
```

当前版本没有数据库、缓存、外部对象存储或第三方鉴权依赖，也没有额外必填环境变量。

## 4. 发布前检查

正式发布前执行：

```bash
# 完整发布门禁
npm run check
```

`npm run check` 当前包含以下检查：

1. `node --check` 语法检查
2. `npm test` Node 单元与集成测试
3. `npm run report:sim -- 20 100` 随机模拟回归
4. `npm run test:e2e` 浏览器端到端检查
5. 真实启动服务后执行：
   - `/api/health`
   - `/api/version`
   - `/`
   - `/styles.css`
   - `/client/app.js`
   - 前端路由回退 `/room/demo`
   - 缺失资源 `/missing.js` 返回 `404`
   - 建房、加房、准备、开局、首个出牌路径检查

如果只想单独运行某一类检查：

```bash
# 单元与集成测试
npm test

# 随机模拟报告
npm run report:sim -- 20 100

# 浏览器端到端检查
npm run test:e2e
```

## 5. 健康检查与版本接口

### 健康检查

- 路径：`GET /api/health`
- 用途：检查服务是否存活，并返回当前运行摘要

返回字段：

- `ok`
- `service`
- `version`
- `startupAt`
- `uptimeMs`
- `stats.rooms`
- `stats.activeGames`
- `stats.connectedPlayers`
- `stats.sockets`

示例：

```json
{
  "ok": true,
  "service": "hangzhou-mahjong-web-game",
  "version": "0.1.0",
  "startupAt": 1747560000000,
  "uptimeMs": 12345,
  "stats": {
    "rooms": 1,
    "activeGames": 1,
    "connectedPlayers": 2,
    "sockets": 2
  }
}
```

### 版本接口

- 路径：`GET /api/version`
- 用途：返回当前服务版本和启动时间

返回字段：

- `service`
- `version`
- `startupAt`

## 6. 日志说明

当前服务端日志为标准输出 JSON 行日志，来源于 `src/server/app.js` 的 `writeLog()`。

每条日志固定包含：

- `ts`
- `level`
- `event`

按场景会附带以下上下文字段：

- `requestId`
- `method`
- `path`
- `remoteIp`
- `roomCode`
- `playerId`
- `status`
- `action`
- `seat`
- `phase`
- `error`

### 关键日志事件

HTTP 相关：

- `http.request_received`
- `http.request`
- `http.response`
- `http.unhandled_error`

房间相关：

- `room.created`
- `room.joined`
- `room.ready_changed`
- `room.config_updated`
- `room.started`
- `room.reconnected`
- `room.action_applied`
- `room.action_rejected`
- `room.cleaned_up`

限流相关：

- `rate_limit.rejected`

WebSocket 相关：

- `ws.upgrade_request`
- `ws.upgrade_accepted`
- `ws.upgrade_rejected`

### 运维观察建议

上线后优先关注以下指标：

1. `http.unhandled_error` 是否出现
2. `rate_limit.rejected` 是否持续增长
3. `room.cleaned_up` 的 `reason` 分布是否异常
4. `ws.upgrade_rejected` 是否集中出现 `invalid_session`
5. `/api/health` 中的 `rooms`、`activeGames`、`sockets` 是否长期增长不回落

## 7. 房间清理策略

当前房间生命周期采用内存清理策略：

| 场景 | 时长 |
| --- | --- |
| 空房间 | 5 分钟 |
| 长期不活跃房间 | 30 分钟 |
| 已结算房间 | 10 分钟 |

代码常量位置：`src/server/app.js`

```js
const ROOM_TTL_MS = {
  empty: 5 * 60 * 1000,
  inactive: 30 * 60 * 1000,
  settled: 10 * 60 * 1000
};
```

清理触发时机：

1. 每次 API 请求进入时
2. 每次 WebSocket upgrade 时

清理后会删除：

- `rooms` 中的房间状态
- `roomSockets` 中的连接集合

## 8. 输入保护与限流

### 请求体保护

- 请求体上限：`8 KB`
- 超限返回：`413`
- 非法 JSON 返回：`400`

### 昵称限制

- 最大长度：`12` 个字符

### 限流窗口

- 时间窗口：`10` 秒

### 各接口限流阈值

| 范围 | 阈值 |
| --- | --- |
| `createRoom` | 10 秒内 5 次 |
| `joinRoom` | 10 秒内 10 次 |
| `action` | 10 秒内 30 次 |
| `reconnect` | 10 秒内 12 次 |
| `wsUpgrade` | 10 秒内 20 次 |

超过阈值时接口返回 `429`，并记录 `rate_limit.rejected` 日志。

## 9. 常见问题处理

### 9.1 端口占用

现象：启动时报 `EADDRINUSE`。

处理方式：

```bash
# 改用其他端口启动
PORT=8080 npm start
```

### 9.2 健康检查失败

排查顺序：

1. 确认进程已启动
2. 确认 `PORT` 配置与访问端口一致
3. 直接访问 `GET /api/health`
4. 查看标准输出中是否出现 `http.unhandled_error`

### 9.3 房间页面刷新后恢复失败

重点观察：

1. 浏览器本地存储中的 `mahjongRoomSession` 是否存在
2. 服务端是否返回 `room.reconnected`
3. 日志中是否出现 `room.action_rejected` 或 `ws.upgrade_rejected`

常见原因：

1. `sessionToken` 已失效或与 `playerId` 不匹配
2. 房间已被清理
3. 浏览器里保留了过期房间会话

### 9.4 WebSocket 无法建立

重点检查：

1. 是否出现 `ws.upgrade_rejected`
2. `reason` 是否为 `invalid_session` 或 `room_not_found`
3. 客户端是否已先成功完成 `/api/rooms/:code/reconnect`

当前客户端支持自动降级轮询，因此 WebSocket 建立失败时仍可先验证 HTTP 接口是否正常。

### 9.5 发布门禁失败

按失败阶段排查：

1. `npm test` 失败：查看具体测试文件与断言
2. `npm run report:sim -- 20 100` 失败：记录输出中的 `failureSeeds`，按 seed 复现
3. `npm run test:e2e` 失败：检查 Playwright Chromium 依赖是否完整
4. 服务检查失败：直接访问脚本中对应接口复现

E2E 运行环境依赖全局 Playwright Chromium。当前已验证的安装命令：

```bash
# 安装 Playwright
npm install -g playwright

# 安装 Chromium
playwright install chromium

# 安装 Chromium 系统依赖
playwright install-deps chromium
```

## 10. 当前部署限制

这些内容来自当前代码事实，部署时需要明确：

1. 房间与连接状态仅保存在内存中，进程重启后房间会消失
2. 当前固定四人局，人数不足时自动由 AI 补位
3. 当前没有数据库与持久化存档
4. 当前没有多实例共享状态能力，因此正式部署应采用单实例运行
5. 当前没有账号体系，联机依赖游客昵称、`playerId` 和 `sessionToken`
