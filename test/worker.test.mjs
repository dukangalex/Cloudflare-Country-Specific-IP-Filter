// 离线单元测试: mock 上游数据源, 不访问真实网络。
// 运行: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const FIXTURE = [
    '1.1.1.1:443#JP',
    '1.1.1.2:8443#JP',
    '1.1.1.2:8443#JP', // 同地区重复条目, 应被去重
    '2.2.2.1:443#US',
    '2.2.2.2:2053#US',
    '3.3.3.1:443#Unknown', // 无地区归属, 应被跳过 (旧版会误读出地区 "U")
    '3.3.3.2:443#U', // 非法的一位标签, 应被跳过
    'line-without-tag',
    '4.4.4.1:443#DE',
    '',
].join('\n');

let upstreamCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://zip.cm.edu.kg/all.txt') {
        upstreamCalls++;
        return new Response(FIXTURE, { status: 200, headers: { 'content-type': 'text/plain' } });
    }
    return realFetch(input, init);
};

const worker = (await import(new URL('../_worker.js', import.meta.url))).default;

async function call(url, init) {
    const res = await worker.fetch(new Request(url, init));
    return { status: res.status, headers: res.headers, body: await res.text() };
}

test('get_regions: 只返回合法两位地区代码, 按数量降序, 不含 Unknown 误读的 U', async () => {
    const { status, body } = await call('https://x.test/?get_regions=1');
    assert.equal(status, 200);
    assert.deepEqual(JSON.parse(body), ['JP', 'US', 'DE']);
});

test('上游数据在 TTL 内只拉取一次 (缓存生效)', async () => {
    const before = upstreamCalls;
    await call('https://x.test/CFnew/JP');
    await call('https://x.test/edgetunnel/US');
    await call('https://x.test/?get_regions=1');
    assert.equal(upstreamCalls, before, '缓存命中时不应再次请求上游');
});

test('路径路由: edgetunnel 格式与 limit', async () => {
    const { body } = await call('https://x.test/edgetunnel/JP?limit=1');
    const lines = body.split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^1\.1\.1\.\d+:(443|8443)#🇯🇵 日本 1\.1\.1\.\d+:(443|8443)$/);
});

test('路径路由: CFnew 短名格式带上标计数', async () => {
    const { body } = await call('https://x.test/CFnew/JP');
    assert.deepEqual(body.split('\n'), [
        '1.1.1.1:443#🇯🇵 日本¹',
        '1.1.1.2:8443#🇯🇵 日本²',
    ]);
});

test('重复地区参数不产生重复输出', async () => {
    const { body } = await call('https://x.test/CFnew/JP,JP?limit=2');
    assert.equal(body.split('\n').length, 2);
});

test('API 路由: limit 参数生效 (旧版被写死为 0)', async () => {
    const { body } = await call('https://x.test/?api=1&region=US&format=cf_line_short&limit=1');
    assert.equal(body.split('\n').length, 1);
});

test('API 路由: cf_line 格式带端口后缀, comma 格式用逗号分隔', async () => {
    const line = await call('https://x.test/?api=1&region=DE&format=cf_line');
    assert.equal(line.body, '4.4.4.1:443#🇩🇪 德国¹-443');
    const comma = await call('https://x.test/?api=1&region=JP&format=cf_comma_short');
    assert.equal(comma.body.split(',').length, 2);
    assert.ok(!comma.body.includes('\n'));
});

test('base64=1 输出可正确解码回明文', async () => {
    const plain = await call('https://x.test/CFnew/JP');
    const encoded = await call('https://x.test/CFnew/JP?base64=1');
    assert.equal(Buffer.from(encoded.body, 'base64').toString('utf8'), plain.body);
    const disabled = await call('https://x.test/CFnew/JP?base64=0');
    assert.equal(disabled.body, plain.body);
});

test('非法 limit 归零 (不限制), 未知地区返回空', async () => {
    const neg = await call('https://x.test/CFnew/JP?limit=-3');
    assert.equal(neg.body.split('\n').length, 2);
    const none = await call('https://x.test/CFnew/XX');
    assert.equal(none.status, 200);
    assert.equal(none.body, '');
});

test('方法限制与畸形路径编码', async () => {
    const put = await call('https://x.test/', { method: 'PUT' });
    assert.equal(put.status, 405);
    const bad = await call('https://x.test/CFnew/%E0%A4%A');
    assert.equal(bad.status, 400);
    const opt = await worker.fetch(new Request('https://x.test/', { method: 'OPTIONS' }));
    assert.equal(opt.status, 200);
    assert.equal(opt.headers.get('access-control-allow-origin'), '*');
});
