import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import process from 'node:process';
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';

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
    } catch {}
    await sleep(150);
  }
  throw new Error(`服务启动检查失败: ${baseUrl}`);
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

async function createRoom(baseUrl, name) {
  const response = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`创建房间失败: ${response.status}`);
  return response.json();
}

async function joinRoom(baseUrl, code, name) {
  const response = await fetch(`${baseUrl}/api/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error(`加入房间失败: ${response.status}`);
  return response.json();
}

async function waitForGameReady(page) {
  await page.waitForSelector('.mahjong-table');
  await page.waitForSelector('[data-tile]');
  await page.waitForSelector('#discard');
}

async function expectText(locator, pattern, message) {
  const text = await locator.textContent();
  if (!text || !pattern.test(text)) {
    throw new Error(`${message}: ${text || '空文本'}`);
  }
}

async function performFirstDiscard(page) {
  const firstTile = page.locator('[data-tile]').first();
  await firstTile.click();
  await page.locator('#discard').click();
  await page.locator('#discard').click();
  await page.waitForTimeout(300);
}

async function verifySoloFlow(baseUrl, browser) {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.locator('#name').fill('单机测试');
  await page.locator('#solo').click();
  await waitForGameReady(page);
  await expectText(page.locator('.badge').first(), /单机模式/, '单机页顶部模式标识异常');
  await expectText(page.locator('.cai-tip'), /财神：白板/, '单机页财神提示异常');
  await expectText(page.locator('.draw-tip'), /新摸牌会用金色光圈标出/, '单机页操作提示异常');
  await performFirstDiscard(page);
  await page.waitForSelector('.message');
  await page.waitForFunction(() => document.querySelectorAll('.river-tiles .mini-tile').length > 0);
  await page.waitForFunction(() => {
    const log = document.querySelector('.log');
    return Boolean(log && log.textContent && log.textContent.trim().length > 0);
  });
  await page.close();
}

async function verifyRoomFlow(baseUrl, browser) {
  const host = await createRoom(baseUrl, '房主测试');
  const guest = await joinRoom(baseUrl, host.code, '客人测试');

  const hostPage = await browser.newPage();
  const guestPage = await browser.newPage();

  await hostPage.goto(baseUrl);
  await guestPage.goto(baseUrl);

  await hostPage.evaluate((session) => {
    localStorage.setItem('mahjongRoomSession', JSON.stringify(session));
  }, {
    roomCode: host.code,
    playerId: host.playerId,
    sessionToken: host.sessionToken,
    mode: 'room',
    screen: 'room'
  });

  await guestPage.evaluate(({ code, playerId, sessionToken }) => {
    localStorage.setItem('mahjongRoomSession', JSON.stringify({
      roomCode: code,
      playerId,
      sessionToken,
      mode: 'room',
      screen: 'room'
    }));
  }, {
    code: host.code,
    playerId: guest.playerId,
    sessionToken: guest.sessionToken
  });

  await hostPage.reload();
  await guestPage.reload();

  await hostPage.waitForSelector('#toggleReady');
  await guestPage.waitForSelector('#toggleReady');
  await expectText(hostPage.locator('.badge').first(), new RegExp(`房间 ${host.code}`), '房主页房间号展示异常');
  await expectText(guestPage.locator('.badge').first(), new RegExp(`房间 ${host.code}`), '客页房间号展示异常');

  const guestReadyText = await guestPage.locator('#toggleReady').textContent();
  if (guestReadyText?.includes('准备')) await guestPage.locator('#toggleReady').click();

  await hostPage.waitForFunction(() => document.body.textContent.includes('客人测试') && document.body.textContent.includes('已准备'));

  await hostPage.waitForFunction(() => {
    const button = document.querySelector('#startRoom');
    return button && !button.hasAttribute('disabled');
  });
  await hostPage.locator('#startRoom').click();

  await waitForGameReady(hostPage);
  await waitForGameReady(guestPage);
  await expectText(hostPage.locator('.table-status-grid').first(), /当前操作者|庄家/, '房主牌桌状态信息缺失');
  await expectText(guestPage.locator('.table-status-grid').first(), /当前操作者|庄家/, '客人牌桌状态信息缺失');
  await performFirstDiscard(hostPage);
  await hostPage.waitForFunction(() => document.querySelectorAll('.river-tiles .mini-tile').length > 0);
  await guestPage.waitForFunction(() => document.querySelectorAll('.river-tiles .mini-tile').length > 0);
  await hostPage.waitForFunction(() => {
    const log = document.querySelector('.log');
    return Boolean(log && log.textContent && /打出|摸到|轮到/.test(log.textContent));
  });
  await guestPage.waitForFunction(() => {
    const log = document.querySelector('.log');
    return Boolean(log && log.textContent && /打出|摸到|轮到/.test(log.textContent));
  });

  await hostPage.close();
  await guestPage.close();
}

await withServer(async (baseUrl) => {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifySoloFlow(baseUrl, browser);
    await verifyRoomFlow(baseUrl, browser);
  } finally {
    await browser.close();
  }
});

process.stdout.write('E2E 冒烟检查通过\n');
