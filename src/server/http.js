export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

export async function readBody(req, options = {}) {
  const { maxBytes = 16 * 1024 } = options;
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) throw new HttpError(413, '请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体 JSON 格式无效');
  }
}

export function sendError(res, error) {
  json(res, 500, { error: error instanceof Error ? error.message : '服务器内部错误' });
}
