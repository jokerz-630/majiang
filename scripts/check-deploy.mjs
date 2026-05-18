import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import pkg from '../package.json' with { type: 'json' };

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 失败，退出码 ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('临时端口分配失败'));
        return;
      }
      const { port } = address;
      probe.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function waitForServer(baseUrl, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch {
      await sleep(150);
      continue;
    }
    await sleep(150);
  }
  throw new Error(`服务启动检查失败: ${baseUrl}`);
}

async function verifyStaticAssets(baseUrl) {
  const homeRes = await fetch(`${baseUrl}/`);
  if (!homeRes.ok) throw new Error(`首页检查失败，状态码 ${homeRes.status}`);
  const homeHtml = await homeRes.text();
  if (!homeHtml.includes('<main id="app"></main>')) throw new Error('首页缺少应用挂载节点');
  if (!homeHtml.includes('/styles.css')) throw new Error('首页缺少样式资源入口');
  if (!homeHtml.includes('/client/app.js')) throw new Error('首页缺少前端脚本入口');

  const stylesRes = await fetch(`${baseUrl}/styles.css`);
  if (!stylesRes.ok) throw new Error(`样式资源检查失败，状态码 ${stylesRes.status}`);
  const stylesSource = await stylesRes.text();
  if (!stylesSource.includes('.mahjong-table')) throw new Error('样式资源内容异常');

  const appRes = await fetch(`${baseUrl}/client/app.js`);
  if (!appRes.ok) throw new Error(`前端入口脚本检查失败，状态码 ${appRes.status}`);
  const appSource = await appRes.text();
  if (!appSource.includes('roomSocketUrl')) throw new Error('前端入口脚本内容异常');

  const routeFallbackRes = await fetch(`${baseUrl}/room/demo`);
  if (!routeFallbackRes.ok) throw new Error(`前端路由回退检查失败，状态码 ${routeFallbackRes.status}`);
  const routeFallbackHtml = await routeFallbackRes.text();
  if (!routeFallbackHtml.includes('<main id="app"></main>')) throw new Error('前端路由回退未返回应用入口');

  const missingAssetRes = await fetch(`${baseUrl}/missing.js`);
  if (missingAssetRes.status !== 404) throw new Error(`缺失静态资源应返回 404，实际状态码 ${missingAssetRes.status}`);
}

async function verifyServiceMeta(baseUrl) {
  const healthRes = await fetch(`${baseUrl}/api/health`);
  if (!healthRes.ok) throw new Error(`健康检查失败，状态码 ${healthRes.status}`);
  const health = await healthRes.json();
  if (health.ok !== true) throw new Error('健康检查未返回 ok=true');
  if (health.service !== pkg.name) throw new Error(`健康检查服务名异常: ${health.service}`);
  if (health.version !== pkg.version) throw new Error(`健康检查版本号异常: ${health.version}`);
  if (!health.startupAt || typeof health.uptimeMs !== 'number' || health.uptimeMs < 0) throw new Error('健康检查缺少运行时间信息');
  if (!health.stats || typeof health.stats.rooms !== 'number') throw new Error('健康检查缺少房间统计');
  if (typeof health.stats.activeGames !== 'number' || typeof health.stats.connectedPlayers !== 'number' || typeof health.stats.sockets !== 'number') {
    throw new Error('健康检查统计字段不完整');
  }

  const versionRes = await fetch(`${baseUrl}/api/version`);
  if (!versionRes.ok) throw new Error(`版本接口失败，状态码 ${versionRes.status}`);
  const version = await versionRes.json();
  if (version.service !== pkg.name) throw new Error(`版本接口服务名异常: ${version.service}`);
  if (version.version !== pkg.version) throw new Error(`版本接口版本号异常: ${version.version}`);
  if (!version.startupAt) throw new Error('版本接口返回字段不完整');
  if (version.startupAt !== health.startupAt) throw new Error('版本接口与健康检查启动时间不一致');
}

async function verifyRoomFlow(baseUrl) {
  const createRes = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '检查房主' })
  });
  if (!createRes.ok) throw new Error(`创建房间失败，状态码 ${createRes.status}`);
  const created = await createRes.json();
  if (!created.code || !created.playerId || !created.sessionToken) throw new Error('创建房间返回字段不完整');

  const joinRes = await fetch(`${baseUrl}/api/rooms/${created.code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '检查客人' })
  });
  if (!joinRes.ok) throw new Error(`加入房间失败，状态码 ${joinRes.status}`);
  const joined = await joinRes.json();
  if (!joined.playerId || !joined.sessionToken) throw new Error('加入房间返回字段不完整');

  const readyRes = await fetch(`${baseUrl}/api/rooms/${created.code}/ready`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: joined.playerId, sessionToken: joined.sessionToken, ready: true })
  });
  if (!readyRes.ok) throw new Error(`房间准备失败，状态码 ${readyRes.status}`);

  const roomRes = await fetch(`${baseUrl}/api/rooms/${created.code}?playerId=${created.playerId}&sessionToken=${created.sessionToken}`);
  if (!roomRes.ok) throw new Error(`房间查询失败，状态码 ${roomRes.status}`);
  const room = await roomRes.json();
  if (room.players?.length !== 2) throw new Error('房间查询结果异常');
  if (room.config?.fillWithAi !== true) throw new Error('房间配置检查失败');
  if (!Array.isArray(room.standings)) throw new Error('房间累计战绩字段缺失');

  const startRes = await fetch(`${baseUrl}/api/rooms/${created.code}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: created.playerId, sessionToken: created.sessionToken })
  });
  if (!startRes.ok) throw new Error(`房间开局失败，状态码 ${startRes.status}`);

  const startedRoomRes = await fetch(`${baseUrl}/api/rooms/${created.code}?playerId=${created.playerId}&sessionToken=${created.sessionToken}`);
  if (!startedRoomRes.ok) throw new Error(`开局后房间查询失败，状态码 ${startedRoomRes.status}`);
  const startedRoom = await startedRoomRes.json();
  if (startedRoom.game?.phase !== 'playing') throw new Error(`开局后牌局阶段异常: ${startedRoom.game?.phase}`);
  if (!Array.isArray(startedRoom.game?.players) || startedRoom.game.players.length !== 4) throw new Error('开局后玩家数量异常');
  const discardAction = startedRoom.game?.actions?.find((action) => action.type === 'discard');
  if (!discardAction?.tileId) throw new Error('开局后未找到首个出牌动作');

  const actionRes = await fetch(`${baseUrl}/api/rooms/${created.code}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      playerId: created.playerId,
      sessionToken: created.sessionToken,
      action: 'discard',
      tileId: discardAction.tileId
    })
  });
  if (!actionRes.ok) throw new Error(`首个出牌动作失败，状态码 ${actionRes.status}`);

  const afterActionRes = await fetch(`${baseUrl}/api/rooms/${created.code}?playerId=${created.playerId}&sessionToken=${created.sessionToken}`);
  if (!afterActionRes.ok) throw new Error(`动作后房间查询失败，状态码 ${afterActionRes.status}`);
  const afterActionRoom = await afterActionRes.json();
  const self = afterActionRoom.game?.players?.find((player) => player.id === created.playerId);
  if (!self || !Array.isArray(self.discards) || self.discards.length < 1) throw new Error('首个出牌后弃牌区未更新');
}

async function withServer(task) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit'
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    await Promise.race([
      waitForServer(baseUrl),
      exitPromise.then(({ code, signal }) => {
        throw new Error(`服务启动失败，进程已退出: code=${code ?? 'null'} signal=${signal ?? 'null'}`);
      })
    ]);
    await task(baseUrl);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    await exitPromise;
  }
}

await run('node', ['--check', 'server.js']);
await run('node', ['--check', 'src/server/app.js']);
await run('node', ['--check', 'public/app.js']);
await run('node', ['--check', 'public/client/app.js']);
await run('npm', ['test']);
await run('npm', ['run', 'report:sim', '--', '20', '100']);
await run('npm', ['run', 'test:e2e']);
await withServer(async (baseUrl) => {
  await verifyServiceMeta(baseUrl);
  await verifyStaticAssets(baseUrl);
  await verifyRoomFlow(baseUrl);
});

process.stdout.write('部署前检查通过\n');
