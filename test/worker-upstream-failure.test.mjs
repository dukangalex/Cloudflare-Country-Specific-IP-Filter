// 上游故障时的行为: 无缓存可降级时应明确报错 (502), 而不是返回假装正常的空数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.fetch = async () => new Response('boom', { status: 500 });

const worker = (await import(new URL('../_worker.js', import.meta.url))).default;

test('上游 500 且无缓存: 列表路由返回 502', async () => {
    const res = await worker.fetch(new Request('https://x.test/CFnew/JP'));
    assert.equal(res.status, 502);
    assert.match(await res.text(), /^Error fetching data: /);
});

test('上游 500 且无缓存: get_regions 返回 502 + []', async () => {
    const res = await worker.fetch(new Request('https://x.test/?get_regions=1'));
    assert.equal(res.status, 502);
    assert.equal(await res.text(), '[]');
});
