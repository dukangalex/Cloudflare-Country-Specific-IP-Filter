/**
 * Cloudflare Country-Specific IP Filter
 *
 * 按国家/地区筛选 Cloudflare 优选 IP 的单文件 Worker。
 * 数据源: https://zip.cm.edu.kg/all.txt (每行格式: IP:PORT#CC, CC 为两位地区代码)
 *
 * 路由:
 *   /CFnew/<地区-地区>?limit=N&base64=1      CFnew 风格节点列表
 *   /edgetunnel/<地区-地区>?limit=N&base64=1 edgetunnel 风格节点列表
 *   /?api=1&region=JP,US&format=cf_line_short&limit=N&base64=1
 *   /?get_regions=1                          全部地区代码 (按 IP 数量降序)
 *   /                                        网页界面
 */

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const UPSTREAM_URL = 'https://zip.cm.edu.kg/all.txt';
const DATASET_TTL_MS = 5 * 60 * 1000; // 上游数据在 isolate 内缓存 5 分钟, 避免每次请求都拉 350KB+
const UPSTREAM_TIMEOUT_MS = 8000;     // 上游请求超时
const MAX_LIMIT = 5000;               // 单地区 limit 上限 (防滥用, 远大于任一地区现有池子)

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
};

const NO_STORE = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';

const REGION_MAP = {
    // 亚太地区 (Asia Pacific)
    'JP': '日本', 'KR': '韩国', 'SG': '新加坡', 'HK': '香港', 'TW': '台湾',
    'MY': '马来西亚', 'TH': '泰国', 'VN': '越南', 'PH': '菲律宾', 'ID': '印尼',
    'IN': '印度', 'AU': '澳大利亚', 'NZ': '新西兰', 'KH': '柬埔寨', 'MO': '澳门',
    'BD': '孟加拉', 'PK': '巴基斯坦', 'NP': '尼泊尔', 'MN': '蒙古', 'LK': '斯里兰卡',
    'LA': '老挝', 'BN': '文莱', 'MM': '缅甸', 'BT': '不丹', 'MV': '马尔代夫',
    'AF': '阿富汗', 'TJ': '塔吉克斯坦', 'TM': '土库曼斯坦', 'TL': '东帝汶', 'FJ': '斐济', 
    'PG': '巴布亚新几内亚', 'SB': '所罗门群岛', 'VU': '瓦努阿图', 'WS': '萨摩亚', 'TO': '汤加', 
    'TV': '图瓦卢', 'KI': '基里巴斯', 'MH': '马绍尔群岛', 'FM': '密克罗尼西亚', 'PW': '帕劳', 
    'NR': '瑙鲁', 'CK': '库克群岛', 'NU': '纽埃', 'NC': '新喀里多尼亚', 'PF': '法属波利尼西亚', 
    'MP': '北马里亚纳群岛', 'AS': '美属萨摩亚', 'IO': '英属印度洋领地', 'CC': '科科斯群岛', 
    'CX': '圣诞岛', 'NF': '诺福克岛', 'TK': '托克劳', 'WF': '瓦利斯和富图纳', 'PN': '皮特凯恩群岛', 
    'UM': '美国本土外小岛屿',

    // 北美洲 (North America)
    'US': '美国', 'CA': '加拿大', 'MX': '墨西哥', 'PR': '波多黎各', 'GU': '关岛',
    'PM': '圣皮埃尔和密克隆', 'BM': '百慕大', 'GL': '格陵兰',

    // 欧洲 (Europe)
    'GB': '英国', 'UK': '英国', 'DE': '德国', 'FR': '法国', 'NL': '荷兰', 'IT': '意大利',
    'ES': '西班牙', 'PT': '葡萄牙', 'RU': '俄罗斯', 'UA': '乌克兰', 'PL': '波兰',
    'SE': '瑞典', 'FI': '芬兰', 'NO': '挪威', 'DK': '丹麦', 'IS': '冰岛',
    'IE': '爱尔兰', 'BE': '比利时', 'LU': '卢森堡', 'CH': '瑞士', 'AT': '奥地利',
    'CZ': '捷克', 'HU': '匈牙利', 'RO': '罗马尼亚', 'BG': '保加利亚', 'GR': '希腊',
    'TR': '土耳其', 'HR': '克罗地亚', 'RS': '塞尔维亚', 'SI': '斯洛文尼亚', 'SK': '斯洛伐克',
    'EE': '爱沙尼亚', 'LV': '拉脱维亚', 'LT': '立陶宛', 'MD': '摩尔多瓦', 'AL': '阿尔巴尼亚',
    'BA': '波黑', 'ME': '黑山', 'MK': '北马其顿', 'CY': '塞浦路斯', 'MT': '马耳他',
    'BY': '白俄罗斯', 'GE': '格鲁吉亚', 'AM': '亚美尼亚', 'AZ': '阿塞拜疆', 'LI': '列支敦士登',
    'AD': '安道尔', 'MC': '摩纳哥', 'SM': '圣马力诺', 'VA': '梵蒂冈', 'FO': '法罗群岛', 
    'GI': '直布罗陀', 'IM': '马恩岛', 'JE': '泽西岛', 'GG': '根西岛', 'AX': '奥兰群岛', 
    'SJ': '斯瓦尔巴和扬马延',

    // 南美洲 (South America)
    'BR': '巴西', 'AR': '阿根廷', 'CL': '智利', 'CO': '哥伦比亚', 'PE': '秘鲁',
    'EC': '厄瓜多尔', 'UY': '乌拉圭', 'PY': '巴拉圭', 'VE': '委内瑞拉', 'BO': '玻利维亚',
    'GY': '圭亚那', 'SR': '苏里南', 'FK': '福克兰群岛', 'GF': '法属圭亚那', 'GS': '南乔治亚和南桑威奇群岛',

    // 中美洲与加勒比 (Central America & Caribbean)
    'PA': '巴拿马', 'CR': '哥斯达黎加', 'GT': '危地马拉', 'HN': '洪都拉斯', 'SV': '萨尔瓦多',
    'NI': '尼加拉瓜', 'JM': '牙买加', 'DO': '多米尼加', 'BS': '巴哈马', 'TT': '特立尼达多巴哥',
    'BB': '巴巴多斯', 'CW': '库拉索', 'BZ': '伯利兹', 'DM': '多米尼克', 'GD': '格林纳达', 
    'KN': '圣基茨和尼维斯', 'LC': '圣卢西亚', 'VC': '圣文森特和格林纳丁斯', 'HT': '海地', 
    'CU': '古巴', 'AW': '阿鲁巴', 'BQ': '荷兰加勒比区', 'SX': '荷属圣马丁', 'MF': '法属圣马丁', 
    'BL': '圣巴泰勒米', 'AI': '安圭拉', 'KY': '开曼群岛', 'TC': '特克斯和凯科斯群岛', 
    'VG': '英属维尔京群岛', 'VI': '美属维尔京群岛', 'MS': '蒙特塞拉特', 'AG': '安提瓜和巴布达',

    // 中东与非洲 (Middle East & Africa)
    'ZA': '南非', 'EG': '埃及', 'MA': '摩洛哥', 'DZ': '阿尔及利亚', 'TN': '突尼斯',
    'NG': '尼日利亚', 'KE': '肯尼亚', 'GH': '加纳', 'TZ': '坦桑尼亚', 'UG': '乌干达',
    'MU': '毛里求斯', 'RE': '留尼汪', 'AO': '安哥拉', 'MZ': '莫桑比克', 'SN': '塞内加尔',
    'AE': '阿联酋', 'SA': '沙特', 'IL': '以色列', 'QA': '卡塔尔', 'BH': '巴林',
    'KW': '科威特', 'OM': '阿曼', 'JO': '约旦', 'LB': '黎巴嫩', 'IQ': '伊拉克',
    'KZ': '哈萨克斯坦', 'UZ': '乌兹别克斯坦', 'KG': '吉尔吉斯斯坦', 'SY': '叙利亚', 
    'YE': '也门', 'IR': '伊朗', 'PS': '巴勒斯坦', 'MR': '毛里塔尼亚', 'ML': '马里', 'NE': '尼日尔', 
    'TD': '乍得', 'SD': '苏丹', 'SS': '南苏丹', 'ER': '厄立特里亚', 'DJ': '吉布提', 'SO': '索马里', 
    'ET': '埃塞俄比亚', 'CV': '佛得角', 'GW': '几内亚比绍', 'GM': '冈比亚', 'GN': '几内亚', 
    'SL': '塞拉利昂', 'LR': '利比里亚', 'CI': '科特迪瓦', 'BF': '布基纳法索', 'TG': '多哥', 
    'BJ': '贝宁', 'CM': '喀麦隆', 'CF': '中非', 'GQ': '赤道几内亚', 'GA': '加蓬', 
    'CG': '刚果共和国', 'CD': '刚果民主共和国', 'ST': '圣多美和普林西比', 'RW': '卢旺达', 
    'BI': '布隆迪', 'ZM': '赞比亚', 'MW': '马拉维', 'ZW': '津巴布韦', 'BW': '博茨瓦纳', 
    'NA': '纳米比亚', 'LS': '莱索托', 'SZ': '斯威士兰', 'MG': '马达加斯加', 'KM': '科摩罗', 
    'SC': '塞舌尔', 'YT': '马约特', 'SH': '圣赫勒拿', 'EH': '西撒哈拉',

    // 南极洲与其他偏远岛屿 (Antarctica & Other Islands)
    'AQ': '南极洲', 'TF': '法属南部领地', 'BV': '布韦岛', 'HM': '赫德岛和麦克唐纳群岛'
};

/**
 * 辅助函数：获取国旗 Emoji
 */
function getFlagEmoji(code) {
    if (code === 'TW') return '🇹🇼';
    if (code === 'UK') return '🇬🇧';
    if (!code || code.length !== 2) return '🇺🇳';
    const codePoints = code.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
}

/**
 * 辅助函数：数字转上标
 */
function toSuperScript(num) {
    const supers = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    return num.toString().split('').map(c => supers[c] || c).join('');
}

/**
 * Fisher-Yates 部分洗牌: 从 pool 中无偏随机抽取 count 个元素 (不改原数组)
 */
function sample(pool, count) {
    const arr = [...pool];
    const n = Math.min(count, arr.length);
    for (let i = 0; i < n; i++) {
        const j = i + Math.floor(Math.random() * (arr.length - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, n);
}

/** 解析 limit 参数: 非法/负数归 0 (不限制), 超过上限截断 */
function parseLimit(searchParams) {
    const n = Number.parseInt(searchParams.get('limit'), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, MAX_LIMIT);
}

/** 解析地区列表: 大写、去空、去重 (保持首次出现顺序) */
function parseRegions(regionStr) {
    let decoded = regionStr || '';
    try { decoded = decodeURIComponent(decoded); } catch { /* 已解码或非法编码, 用原文继续 */ }
    const seen = new Set();
    const regions = [];
    for (const part of decoded.split(/[,-]/)) {
        const code = part.trim().toUpperCase();
        if (code && !seen.has(code)) {
            seen.add(code);
            regions.push(code);
        }
    }
    return regions;
}

/** UTF-8 安全的 base64 编码 (替代已废弃的 unescape 技巧) */
function base64Utf8(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

// ---------------------------------------------------------------------------
// 数据层: 上游数据只拉取/解析一次, TTL 内复用; 并发请求合并为一次拉取;
// 拉取失败时若有旧数据则降级用旧数据, 不让上游抖动直接打挂服务。
// ---------------------------------------------------------------------------
let datasetCache = null;    // { pools: Map<string, string[]>, regions: string[], total: number, fetchedAt: number }
let datasetInflight = null; // Promise, 合并并发拉取

function parseDataset(text) {
    const pools = new Map();
    const counts = {}; // 保持地区首次出现顺序, 供排序稳定
    let total = 0;
    const clean = text.replace(/^\uFEFF/, '');
    for (const rawLine of clean.split('\n')) {
        const line = rawLine.trim();
        const hashIdx = line.indexOf('#');
        if (hashIdx < 0) continue;
        const ipPort = line.slice(0, hashIdx).trim();
        const code = line.slice(hashIdx + 1).trim().toUpperCase();
        // 只收合法的两位地区代码: 上游的 "#Unknown" 等异常标签会被
        // 旧正则误读成地区 "U", 这里直接跳过无地区归属的条目
        if (!/^[A-Z]{2}$/.test(code)) continue;
        if (!/^\S+:\d+$/.test(ipPort)) continue;
        let pool = pools.get(code);
        if (!pool) {
            pool = { list: [], seen: new Set() };
            pools.set(code, pool);
            counts[code] = 0;
        }
        if (pool.seen.has(ipPort)) continue; // 同地区内去重
        pool.seen.add(ipPort);
        pool.list.push(ipPort);
        counts[code]++;
        total++;
    }
    const flatPools = new Map();
    for (const [code, pool] of pools) flatPools.set(code, pool.list);
    // 按 IP 数量降序 (稳定排序, 数量相同保持数据源出现顺序)
    const regions = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    return { pools: flatPools, regions, total };
}

async function loadDataset() {
    if (datasetCache && Date.now() - datasetCache.fetchedAt < DATASET_TTL_MS) {
        return datasetCache;
    }
    if (datasetInflight) return datasetInflight;
    datasetInflight = (async () => {
        try {
            const init = {
                headers: { 'User-Agent': 'Cloudflare-Country-Specific-IP-Filter/2.0' },
                // 让 Cloudflare 边缘也缓存上游响应, 跨 isolate 共享
                cf: { cacheTtl: 300, cacheEverything: true },
            };
            if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
                init.signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
            }
            const res = await fetch(UPSTREAM_URL, init);
            if (!res.ok) throw new Error(`upstream responded ${res.status}`);
            const parsed = parseDataset(await res.text());
            if (parsed.total === 0) throw new Error('upstream returned no usable entries');
            datasetCache = { ...parsed, fetchedAt: Date.now() };
            return datasetCache;
        } catch (e) {
            if (datasetCache) return datasetCache; // 降级: 用上次成功的数据
            throw e;
        } finally {
            datasetInflight = null;
        }
    })();
    return datasetInflight;
}

// ---------------------------------------------------------------------------
// 响应辅助
// ---------------------------------------------------------------------------
function textResponse(body, status = 200, extraHeaders = {}) {
    return new Response(body, {
        status,
        headers: {
            'content-type': 'text/plain; charset=UTF-8',
            'Cache-Control': NO_STORE,
            ...CORS_HEADERS,
            ...extraHeaders,
        },
    });
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
    return new Response(body, {
        status,
        headers: {
            'content-type': 'application/json; charset=UTF-8',
            ...CORS_HEADERS,
            ...extraHeaders,
        },
    });
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------
export default {
    async fetch(request) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }
        if (!['GET', 'HEAD', 'POST'].includes(request.method)) {
            return textResponse('Method Not Allowed', 405, { Allow: 'GET, HEAD, POST, OPTIONS' });
        }
        const url = new URL(request.url);
        const limit = parseLimit(url.searchParams);

        // 路径路由: /CFnew/JP-US 或 /edgetunnel/JP-US
        let rawPath;
        try {
            rawPath = decodeURIComponent(url.pathname);
        } catch {
            return textResponse('Bad Request: malformed path encoding', 400);
        }
        const pathMatches = rawPath.replace(/\/+$/, '').match(/^\/(CFnew|edgetunnel)\/(.+)$/);
        if (pathMatches) {
            const format = pathMatches[1] === 'CFnew' ? 'cf_line_short' : 'line';
            return handleRawRequest(pathMatches[2], format, limit, url);
        }

        if (url.searchParams.has('api')) return handleApiRequest(url);
        if (url.searchParams.has('get_regions')) return handleGetRegions();

        return new Response(getHtml(), {
            headers: {
                'content-type': 'text/html; charset=UTF-8',
                'X-Content-Type-Options': 'nosniff',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                ...CORS_HEADERS,
            },
        });
    }
};

async function handleGetRegions() {
    try {
        const dataset = await loadDataset();
        return jsonResponse(JSON.stringify(dataset.regions), 200, {
            'Cache-Control': 'public, max-age=60',
        });
    } catch (e) {
        return jsonResponse('[]', 502);
    }
}

async function handleApiRequest(url) {
    const regions = url.searchParams.get('region') || '';
    const format = url.searchParams.get('format') || 'line';
    const limit = parseLimit(url.searchParams); // 修复: 旧版 API 路由把 limit 写死为 0, 参数被忽略
    return handleRawRequest(regions, format, limit, url);
}

async function handleRawRequest(regionStr, format, limit = 0, sourceUrl = null) {
    const targetRegions = parseRegions(regionStr);
    const fmt = String(format || 'line').toLowerCase();

    let needBase64 = false;
    if (sourceUrl) {
        needBase64 = sourceUrl.searchParams.has('base64') && sourceUrl.searchParams.get('base64') !== '0';
    }

    let dataset;
    try {
        dataset = await loadDataset();
    } catch (e) {
        return textResponse('Error fetching data: ' + e.message, 502);
    }

    const selectedItems = [];
    for (const region of targetRegions) {
        const pool = dataset.pools.get(region);
        if (!pool || pool.length === 0) continue;
        if (limit > 0 && pool.length > limit) {
            for (const ipPort of sample(pool, limit)) selectedItems.push({ code: region, ipPort });
        } else {
            for (const ipPort of pool) selectedItems.push({ code: region, ipPort });
        }
    }

    const processed = [];
    const isCFStyle = fmt.startsWith('cf') || fmt === 'comma';
    const isShortName = fmt.includes('short');
    const isLineSeparated = fmt.includes('line');
    const regionCounters = {};

    for (const { code, ipPort } of selectedItems) {
        const flag = getFlagEmoji(code);
        const name = REGION_MAP[code] || code;

        if (isCFStyle) {
            regionCounters[code] = (regionCounters[code] || 0) + 1;
            const countStr = toSuperScript(regionCounters[code]);
            const port = ipPort.slice(ipPort.lastIndexOf(':') + 1);

            let nodeName = `${flag} ${name}${countStr}`;
            if (!isShortName) nodeName += `-${port}`;

            processed.push(`${ipPort}#${nodeName}`);
        } else {
            processed.push(`${ipPort}#${flag} ${name} ${ipPort}`);
        }
    }

    const separator = (fmt.includes('comma') && !isLineSeparated) ? ',' : '\n';
    let resultStr = processed.join(separator);

    if (needBase64) {
        resultStr = base64Utf8(resultStr);
    }

    return textResponse(resultStr);
}

let _htmlCache = null;
function getHtml() {
    if (_htmlCache) return _htmlCache;
    _htmlCache = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Country-Specific IP Filter</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌏</text></svg>">
    <style>
/* Tailwind CSS v3.4 (MIT) — 预编译静态样式, 构建时生成, 运行时零 CDN */
*, ::before, ::after {
  --tw-border-spacing-x: 0;
  --tw-border-spacing-y: 0;
  --tw-translate-x: 0;
  --tw-translate-y: 0;
  --tw-rotate: 0;
  --tw-skew-x: 0;
  --tw-skew-y: 0;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  --tw-pan-x:  ;
  --tw-pan-y:  ;
  --tw-pinch-zoom:  ;
  --tw-scroll-snap-strictness: proximity;
  --tw-gradient-from-position:  ;
  --tw-gradient-via-position:  ;
  --tw-gradient-to-position:  ;
  --tw-ordinal:  ;
  --tw-slashed-zero:  ;
  --tw-numeric-figure:  ;
  --tw-numeric-spacing:  ;
  --tw-numeric-fraction:  ;
  --tw-ring-inset:  ;
  --tw-ring-offset-width: 0px;
  --tw-ring-offset-color: #fff;
  --tw-ring-color: rgb(59 130 246 / 0.5);
  --tw-ring-offset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000;
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  --tw-blur:  ;
  --tw-brightness:  ;
  --tw-contrast:  ;
  --tw-grayscale:  ;
  --tw-hue-rotate:  ;
  --tw-invert:  ;
  --tw-saturate:  ;
  --tw-sepia:  ;
  --tw-drop-shadow:  ;
  --tw-backdrop-blur:  ;
  --tw-backdrop-brightness:  ;
  --tw-backdrop-contrast:  ;
  --tw-backdrop-grayscale:  ;
  --tw-backdrop-hue-rotate:  ;
  --tw-backdrop-invert:  ;
  --tw-backdrop-opacity:  ;
  --tw-backdrop-saturate:  ;
  --tw-backdrop-sepia:  ;
  --tw-contain-size:  ;
  --tw-contain-layout:  ;
  --tw-contain-paint:  ;
  --tw-contain-style:  ;
}
::backdrop {
  --tw-border-spacing-x: 0;
  --tw-border-spacing-y: 0;
  --tw-translate-x: 0;
  --tw-translate-y: 0;
  --tw-rotate: 0;
  --tw-skew-x: 0;
  --tw-skew-y: 0;
  --tw-scale-x: 1;
  --tw-scale-y: 1;
  --tw-pan-x:  ;
  --tw-pan-y:  ;
  --tw-pinch-zoom:  ;
  --tw-scroll-snap-strictness: proximity;
  --tw-gradient-from-position:  ;
  --tw-gradient-via-position:  ;
  --tw-gradient-to-position:  ;
  --tw-ordinal:  ;
  --tw-slashed-zero:  ;
  --tw-numeric-figure:  ;
  --tw-numeric-spacing:  ;
  --tw-numeric-fraction:  ;
  --tw-ring-inset:  ;
  --tw-ring-offset-width: 0px;
  --tw-ring-offset-color: #fff;
  --tw-ring-color: rgb(59 130 246 / 0.5);
  --tw-ring-offset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000;
  --tw-shadow: 0 0 #0000;
  --tw-shadow-colored: 0 0 #0000;
  --tw-blur:  ;
  --tw-brightness:  ;
  --tw-contrast:  ;
  --tw-grayscale:  ;
  --tw-hue-rotate:  ;
  --tw-invert:  ;
  --tw-saturate:  ;
  --tw-sepia:  ;
  --tw-drop-shadow:  ;
  --tw-backdrop-blur:  ;
  --tw-backdrop-brightness:  ;
  --tw-backdrop-contrast:  ;
  --tw-backdrop-grayscale:  ;
  --tw-backdrop-hue-rotate:  ;
  --tw-backdrop-invert:  ;
  --tw-backdrop-opacity:  ;
  --tw-backdrop-saturate:  ;
  --tw-backdrop-sepia:  ;
  --tw-contain-size:  ;
  --tw-contain-layout:  ;
  --tw-contain-paint:  ;
  --tw-contain-style:  ;
}
*,
::before,
::after {
  box-sizing: border-box;
  border-width: 0;
  border-style: solid;
  border-color: #e5e7eb;
}
::before,
::after {
  --tw-content: '';
}
html,
:host {
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  -moz-tab-size: 4;
  -o-tab-size: 4;
     tab-size: 4;
  font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  font-feature-settings: normal;
  font-variation-settings: normal;
  -webkit-tap-highlight-color: transparent;
}
body {
  margin: 0;
  line-height: inherit;
}
hr {
  height: 0;
  color: inherit;
  border-top-width: 1px;
}
abbr:where([title]) {
  -webkit-text-decoration: underline dotted;
          text-decoration: underline dotted;
}
h1,
h2,
h3,
h4,
h5,
h6 {
  font-size: inherit;
  font-weight: inherit;
}
a {
  color: inherit;
  text-decoration: inherit;
}
b,
strong {
  font-weight: bolder;
}
code,
kbd,
samp,
pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-feature-settings: normal;
  font-variation-settings: normal;
  font-size: 1em;
}
small {
  font-size: 80%;
}
sub,
sup {
  font-size: 75%;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
}
sub {
  bottom: -0.25em;
}
sup {
  top: -0.5em;
}
table {
  text-indent: 0;
  border-color: inherit;
  border-collapse: collapse;
}
button,
input,
optgroup,
select,
textarea {
  font-family: inherit;
  font-feature-settings: inherit;
  font-variation-settings: inherit;
  font-size: 100%;
  font-weight: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  color: inherit;
  margin: 0;
  padding: 0;
}
button,
select {
  text-transform: none;
}
button,
input:where([type='button']),
input:where([type='reset']),
input:where([type='submit']) {
  -webkit-appearance: button;
  background-color: transparent;
  background-image: none;
}
:-moz-focusring {
  outline: auto;
}
:-moz-ui-invalid {
  box-shadow: none;
}
progress {
  vertical-align: baseline;
}
::-webkit-inner-spin-button,
::-webkit-outer-spin-button {
  height: auto;
}
[type='search'] {
  -webkit-appearance: textfield;
  outline-offset: -2px;
}
::-webkit-search-decoration {
  -webkit-appearance: none;
}
::-webkit-file-upload-button {
  -webkit-appearance: button;
  font: inherit;
}
summary {
  display: list-item;
}
blockquote,
dl,
dd,
h1,
h2,
h3,
h4,
h5,
h6,
hr,
figure,
p,
pre {
  margin: 0;
}
fieldset {
  margin: 0;
  padding: 0;
}
legend {
  padding: 0;
}
ol,
ul,
menu {
  list-style: none;
  margin: 0;
  padding: 0;
}
dialog {
  padding: 0;
}
textarea {
  resize: vertical;
}
input::-moz-placeholder, textarea::-moz-placeholder {
  opacity: 1;
  color: #9ca3af;
}
input::placeholder,
textarea::placeholder {
  opacity: 1;
  color: #9ca3af;
}
button,
[role="button"] {
  cursor: pointer;
}
:disabled {
  cursor: default;
}
img,
svg,
video,
canvas,
audio,
iframe,
embed,
object {
  display: block;
  vertical-align: middle;
}
img,
video {
  max-width: 100%;
  height: auto;
}
[hidden]:where(:not([hidden="until-found"])) {
  display: none;
}
.container {
  width: 100%;
}
@media (min-width: 640px) {
  .container {
    max-width: 640px;
  }
}
@media (min-width: 768px) {
  .container {
    max-width: 768px;
  }
}
@media (min-width: 1024px) {
  .container {
    max-width: 1024px;
  }
}
@media (min-width: 1280px) {
  .container {
    max-width: 1280px;
  }
}
@media (min-width: 1536px) {
  .container {
    max-width: 1536px;
  }
}
.pointer-events-none {
  pointer-events: none;
}
.fixed {
  position: fixed;
}
.absolute {
  position: absolute;
}
.relative {
  position: relative;
}
.sticky {
  position: sticky;
}
.-bottom-3 {
  bottom: -0.75rem;
}
.left-1\\/2 {
  left: 50%;
}
.right-0 {
  right: 0px;
}
.top-0 {
  top: 0px;
}
.top-14 {
  top: 3.5rem;
}
.top-full {
  top: 100%;
}
.isolate {
  isolation: isolate;
}
.z-10 {
  z-index: 10;
}
.z-20 {
  z-index: 20;
}
.z-50 {
  z-index: 50;
}
.col-span-full {
  grid-column: 1 / -1;
}
.mx-auto {
  margin-left: auto;
  margin-right: auto;
}
.mb-1 {
  margin-bottom: 0.25rem;
}
.mb-6 {
  margin-bottom: 1.5rem;
}
.mr-1 {
  margin-right: 0.25rem;
}
.mr-2 {
  margin-right: 0.5rem;
}
.mt-10 {
  margin-top: 2.5rem;
}
.mt-12 {
  margin-top: 3rem;
}
.mt-2 {
  margin-top: 0.5rem;
}
.mt-4 {
  margin-top: 1rem;
}
.block {
  display: block;
}
.inline {
  display: inline;
}
.flex {
  display: flex;
}
.grid {
  display: grid;
}
.hidden {
  display: none;
}
.h-10 {
  height: 2.5rem;
}
.h-12 {
  height: 3rem;
}
.h-16 {
  height: 4rem;
}
.h-3\\.5 {
  height: 0.875rem;
}
.h-4 {
  height: 1rem;
}
.h-48 {
  height: 12rem;
}
.h-5 {
  height: 1.25rem;
}
.h-6 {
  height: 1.5rem;
}
.h-9 {
  height: 2.25rem;
}
.h-\\[110px\\] {
  height: 110px;
}
.h-\\[34px\\] {
  height: 34px;
}
.min-h-screen {
  min-height: 100vh;
}
.w-10 {
  width: 2.5rem;
}
.w-12 {
  width: 3rem;
}
.w-28 {
  width: 7rem;
}
.w-3\\.5 {
  width: 0.875rem;
}
.w-4 {
  width: 1rem;
}
.w-48 {
  width: 12rem;
}
.w-5 {
  width: 1.25rem;
}
.w-6 {
  width: 1.5rem;
}
.w-9 {
  width: 2.25rem;
}
.w-auto {
  width: auto;
}
.w-full {
  width: 100%;
}
.max-w-0 {
  max-width: 0px;
}
.max-w-5xl {
  max-width: 64rem;
}
.flex-1 {
  flex: 1 1 0%;
}
.flex-shrink-0 {
  flex-shrink: 0;
}
.-translate-x-1\\/2 {
  --tw-translate-x: -50%;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}
.-rotate-0 {
  --tw-rotate: -0deg;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}
.transform {
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}
@keyframes pulse {
  50% {
    opacity: .5;
  }
}
.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.animate-spin {
  animation: spin 1s linear infinite;
}
.cursor-pointer {
  cursor: pointer;
}
.resize-y {
  resize: vertical;
}
.grid-cols-1 {
  grid-template-columns: repeat(1, minmax(0, 1fr));
}
.grid-cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.flex-col {
  flex-direction: column;
}
.flex-wrap {
  flex-wrap: wrap;
}
.items-start {
  align-items: flex-start;
}
.items-center {
  align-items: center;
}
.justify-center {
  justify-content: center;
}
.justify-between {
  justify-content: space-between;
}
.gap-1 {
  gap: 0.25rem;
}
.gap-2 {
  gap: 0.5rem;
}
.gap-3 {
  gap: 0.75rem;
}
.gap-4 {
  gap: 1rem;
}
.gap-6 {
  gap: 1.5rem;
}
.gap-x-6 {
  -moz-column-gap: 1.5rem;
       column-gap: 1.5rem;
}
.gap-y-2 {
  row-gap: 0.5rem;
}
.self-start {
  align-self: flex-start;
}
.overflow-hidden {
  overflow: hidden;
}
.whitespace-nowrap {
  white-space: nowrap;
}
.rounded-2xl {
  border-radius: 1rem;
}
.rounded-\\[2rem\\] {
  border-radius: 2rem;
}
.rounded-lg {
  border-radius: 0.5rem;
}
.rounded-xl {
  border-radius: 0.75rem;
}
.rounded-t-\\[2rem\\] {
  border-top-left-radius: 2rem;
  border-top-right-radius: 2rem;
}
.border {
  border-width: 1px;
}
.border-b {
  border-bottom-width: 1px;
}
.border-t {
  border-top-width: 1px;
}
.border-slate-200 {
  --tw-border-opacity: 1;
  border-color: rgb(226 232 240 / var(--tw-border-opacity, 1));
}
.border-slate-50 {
  --tw-border-opacity: 1;
  border-color: rgb(248 250 252 / var(--tw-border-opacity, 1));
}
.bg-purple-100 {
  --tw-bg-opacity: 1;
  background-color: rgb(243 232 255 / var(--tw-bg-opacity, 1));
}
.bg-slate-100 {
  --tw-bg-opacity: 1;
  background-color: rgb(241 245 249 / var(--tw-bg-opacity, 1));
}
.bg-slate-50 {
  --tw-bg-opacity: 1;
  background-color: rgb(248 250 252 / var(--tw-bg-opacity, 1));
}
.bg-slate-50\\/50 {
  background-color: rgb(248 250 252 / 0.5);
}
.bg-slate-900 {
  --tw-bg-opacity: 1;
  background-color: rgb(15 23 42 / var(--tw-bg-opacity, 1));
}
.bg-transparent {
  background-color: transparent;
}
.bg-white {
  --tw-bg-opacity: 1;
  background-color: rgb(255 255 255 / var(--tw-bg-opacity, 1));
}
.bg-white\\/70 {
  background-color: rgb(255 255 255 / 0.7);
}
.p-1\\.5 {
  padding: 0.375rem;
}
.p-2 {
  padding: 0.5rem;
}
.p-3 {
  padding: 0.75rem;
}
.p-6 {
  padding: 1.5rem;
}
.px-3 {
  padding-left: 0.75rem;
  padding-right: 0.75rem;
}
.px-3\\.5 {
  padding-left: 0.875rem;
  padding-right: 0.875rem;
}
.px-4 {
  padding-left: 1rem;
  padding-right: 1rem;
}
.px-5 {
  padding-left: 1.25rem;
  padding-right: 1.25rem;
}
.px-6 {
  padding-left: 1.5rem;
  padding-right: 1.5rem;
}
.py-1 {
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
}
.py-10 {
  padding-top: 2.5rem;
  padding-bottom: 2.5rem;
}
.py-2 {
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
}
.py-3 {
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}
.py-4 {
  padding-top: 1rem;
  padding-bottom: 1rem;
}
.py-8 {
  padding-top: 2rem;
  padding-bottom: 2rem;
}
.pb-10 {
  padding-bottom: 2.5rem;
}
.pt-4 {
  padding-top: 1rem;
}
.text-left {
  text-align: left;
}
.text-center {
  text-align: center;
}
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
.text-\\[10px\\] {
  font-size: 10px;
}
.text-\\[11px\\] {
  font-size: 11px;
}
.text-\\[13px\\] {
  font-size: 13px;
}
.text-lg {
  font-size: 1.125rem;
  line-height: 1.75rem;
}
.text-sm {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.text-xl {
  font-size: 1.25rem;
  line-height: 1.75rem;
}
.text-xs {
  font-size: 0.75rem;
  line-height: 1rem;
}
.font-bold {
  font-weight: 700;
}
.uppercase {
  text-transform: uppercase;
}
.italic {
  font-style: italic;
}
.leading-relaxed {
  line-height: 1.625;
}
.tracking-tight {
  letter-spacing: -0.025em;
}
.tracking-tighter {
  letter-spacing: -0.05em;
}
.tracking-wider {
  letter-spacing: 0.05em;
}
.tracking-widest {
  letter-spacing: 0.1em;
}
.text-blue-500 {
  --tw-text-opacity: 1;
  color: rgb(59 130 246 / var(--tw-text-opacity, 1));
}
.text-blue-600 {
  --tw-text-opacity: 1;
  color: rgb(37 99 235 / var(--tw-text-opacity, 1));
}
.text-purple-600 {
  --tw-text-opacity: 1;
  color: rgb(147 51 234 / var(--tw-text-opacity, 1));
}
.text-red-400 {
  --tw-text-opacity: 1;
  color: rgb(248 113 113 / var(--tw-text-opacity, 1));
}
.text-slate-400 {
  --tw-text-opacity: 1;
  color: rgb(148 163 184 / var(--tw-text-opacity, 1));
}
.text-slate-500 {
  --tw-text-opacity: 1;
  color: rgb(100 116 139 / var(--tw-text-opacity, 1));
}
.text-slate-700 {
  --tw-text-opacity: 1;
  color: rgb(51 65 85 / var(--tw-text-opacity, 1));
}
.text-white {
  --tw-text-opacity: 1;
  color: rgb(255 255 255 / var(--tw-text-opacity, 1));
}
.opacity-0 {
  opacity: 0;
}
.opacity-30 {
  opacity: 0.3;
}
.opacity-40 {
  opacity: 0.4;
}
.opacity-60 {
  opacity: 0.6;
}
.opacity-70 {
  opacity: 0.7;
}
.opacity-80 {
  opacity: 0.8;
}
.opacity-90 {
  opacity: 0.9;
}
.shadow-2xl {
  --tw-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  --tw-shadow-colored: 0 25px 50px -12px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}
.shadow-lg {
  --tw-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --tw-shadow-colored: 0 10px 15px -3px var(--tw-shadow-color), 0 4px 6px -4px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}
.shadow-sm {
  --tw-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --tw-shadow-colored: 0 1px 2px 0 var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}
.shadow-xl {
  --tw-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --tw-shadow-colored: 0 20px 25px -5px var(--tw-shadow-color), 0 8px 10px -6px var(--tw-shadow-color);
  box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow);
}
.shadow-blue-500\\/20 {
  --tw-shadow-color: rgb(59 130 246 / 0.2);
  --tw-shadow: var(--tw-shadow-colored);
}
.outline-none {
  outline: 2px solid transparent;
  outline-offset: 2px;
}
.ring-1 {
  --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color);
  --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color);
  box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000);
}
.ring-black\\/5 {
  --tw-ring-color: rgb(0 0 0 / 0.05);
}
.blur {
  --tw-blur: blur(8px);
  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);
}
.filter {
  filter: var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow);
}
.backdrop-blur-xl {
  --tw-backdrop-blur: blur(24px);
  -webkit-backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);
  backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);
}
.backdrop-filter {
  -webkit-backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);
  backdrop-filter: var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);
}
.transition {
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, -webkit-backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter;
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter, -webkit-backdrop-filter;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
.transition-colors {
  transition-property: color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
.transition-transform {
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
.duration-300 {
  transition-duration: 300ms;
}
.duration-500 {
  transition-duration: 500ms;
}
.ease-out {
  transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
}
.hover\\:scale-110:hover {
  --tw-scale-x: 1.1;
  --tw-scale-y: 1.1;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}
.hover\\:gap-3:hover {
  gap: 0.75rem;
}
.hover\\:bg-purple-200:hover {
  --tw-bg-opacity: 1;
  background-color: rgb(233 213 255 / var(--tw-bg-opacity, 1));
}
.hover\\:bg-slate-100:hover {
  --tw-bg-opacity: 1;
  background-color: rgb(241 245 249 / var(--tw-bg-opacity, 1));
}
.hover\\:bg-slate-50:hover {
  --tw-bg-opacity: 1;
  background-color: rgb(248 250 252 / var(--tw-bg-opacity, 1));
}
.hover\\:px-5:hover {
  padding-left: 1.25rem;
  padding-right: 1.25rem;
}
.hover\\:text-blue-500:hover {
  --tw-text-opacity: 1;
  color: rgb(59 130 246 / var(--tw-text-opacity, 1));
}
.hover\\:opacity-70:hover {
  opacity: 0.7;
}
.hover\\:opacity-80:hover {
  opacity: 0.8;
}
.hover\\:duration-1000:hover {
  transition-duration: 1000ms;
}
.focus\\:text-blue-500:focus {
  --tw-text-opacity: 1;
  color: rgb(59 130 246 / var(--tw-text-opacity, 1));
}
.group:hover .group-hover\\:max-w-xs {
  max-width: 20rem;
}
.group:hover .group-hover\\:-rotate-12 {
  --tw-rotate: -12deg;
  transform: translate(var(--tw-translate-x), var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y));
}
.group:hover .group-hover\\:opacity-100 {
  opacity: 1;
}
.dark\\:border-slate-600:is(.dark *) {
  --tw-border-opacity: 1;
  border-color: rgb(71 85 105 / var(--tw-border-opacity, 1));
}
.dark\\:border-slate-700:is(.dark *) {
  --tw-border-opacity: 1;
  border-color: rgb(51 65 85 / var(--tw-border-opacity, 1));
}
.dark\\:border-slate-800:is(.dark *) {
  --tw-border-opacity: 1;
  border-color: rgb(30 41 59 / var(--tw-border-opacity, 1));
}
.dark\\:bg-blue-600:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(37 99 235 / var(--tw-bg-opacity, 1));
}
.dark\\:bg-purple-900\\/30:is(.dark *) {
  background-color: rgb(88 28 135 / 0.3);
}
.dark\\:bg-slate-700:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(51 65 85 / var(--tw-bg-opacity, 1));
}
.dark\\:bg-slate-800:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(30 41 59 / var(--tw-bg-opacity, 1));
}
.dark\\:bg-slate-800\\/50:is(.dark *) {
  background-color: rgb(30 41 59 / 0.5);
}
.dark\\:bg-slate-900:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(15 23 42 / var(--tw-bg-opacity, 1));
}
.dark\\:bg-slate-900\\/70:is(.dark *) {
  background-color: rgb(15 23 42 / 0.7);
}
.dark\\:text-blue-400:is(.dark *) {
  --tw-text-opacity: 1;
  color: rgb(96 165 250 / var(--tw-text-opacity, 1));
}
.dark\\:text-purple-400:is(.dark *) {
  --tw-text-opacity: 1;
  color: rgb(192 132 252 / var(--tw-text-opacity, 1));
}
.dark\\:text-slate-200:is(.dark *) {
  --tw-text-opacity: 1;
  color: rgb(226 232 240 / var(--tw-text-opacity, 1));
}
.dark\\:text-slate-300:is(.dark *) {
  --tw-text-opacity: 1;
  color: rgb(203 213 225 / var(--tw-text-opacity, 1));
}
.dark\\:text-slate-400:is(.dark *) {
  --tw-text-opacity: 1;
  color: rgb(148 163 184 / var(--tw-text-opacity, 1));
}
.dark\\:ring-white\\/10:is(.dark *) {
  --tw-ring-color: rgb(255 255 255 / 0.1);
}
.dark\\:hover\\:bg-purple-800\\/50:hover:is(.dark *) {
  background-color: rgb(107 33 168 / 0.5);
}
.dark\\:hover\\:bg-slate-600:hover:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(71 85 105 / var(--tw-bg-opacity, 1));
}
.dark\\:hover\\:bg-slate-700:hover:is(.dark *) {
  --tw-bg-opacity: 1;
  background-color: rgb(51 65 85 / var(--tw-bg-opacity, 1));
}
.dark\\:hover\\:bg-slate-700\\/50:hover:is(.dark *) {
  background-color: rgb(51 65 85 / 0.5);
}
@media (min-width: 640px) {
  .sm\\:block {
    display: block;
  }
  .sm\\:w-auto {
    width: auto;
  }
  .sm\\:flex-none {
    flex: none;
  }
  .sm\\:grid-cols-4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .sm\\:flex-row {
    flex-direction: row;
  }
  .sm\\:self-center {
    align-self: center;
  }
}
@media (min-width: 768px) {
  .md\\:h-64 {
    height: 16rem;
  }
  .md\\:w-auto {
    width: auto;
  }
  .md\\:grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .md\\:grid-cols-6 {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  .md\\:flex-row {
    flex-direction: row;
  }
  .md\\:items-end {
    align-items: flex-end;
  }
  .md\\:p-8 {
    padding: 2rem;
  }
  .md\\:px-6 {
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}
@media (min-width: 1024px) {
  .lg\\:grid-cols-8 {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}

    </style>
    <style>
        body { font-family: Inter, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif; transition: background 0.3s, color 0.3s; }
        .dark { background-color: #060809; color: #f8fafc; }
        .light { background-color: #f4f7f7; color: #0f172a; }
        .glass { border: 1px solid rgba(150,150,150,0.1); }
        .region-card { transition: all 0.2s; border: 2px solid transparent; }
        #regionGrid .region-card.active { border-color: #14b8a6 !important; background-color: rgba(20,184,166,0.16) !important; transform: scale(1.05); font-weight: 700; box-shadow: 0 4px 12px rgba(20, 184, 166, 0.18); position: relative; }
        #regionGrid .region-card.active::after { content: '✓'; position: absolute; top: 1px; right: 6px; color: #14b8a6; font-size: 13px; font-weight: 700; }
        .fira { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
        .dropdown-menu { transform-origin: top right; transition: all 0.2s ease-out; transform: scale(0.95); opacity: 0; pointer-events: none; }
        .dropdown-menu.open { transform: scale(1); opacity: 1; pointer-events: auto; }
        
        /* 弹窗菜单动画与定位修正 */
        .link-menu { 
            transform-origin: top center;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); 
            transform: translate(-50%, -10px) scale(0.95);
            opacity: 0; 
            pointer-events: none; 
        }
        .group:hover .link-menu, 
        .link-menu.open {
            transform: translate(-50%, 0) scale(1);
            opacity: 1;
            pointer-events: auto;
        }

        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { margin: 4px 0; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; }
        
        .btn-matrix { background-color: #0c1113; color: #2dd4bf; border: 1px solid #31424a; font-family: 'JetBrains Mono', ui-monospace, monospace; border-radius: 0.75rem; box-shadow: none; transition: all 0.2s ease; letter-spacing: 1px; position: relative; overflow: hidden; }
        .btn-matrix:hover { background-color: #11181b; border-color: #14b8a6; transform: translateY(-2px); }
        .btn-matrix:active { transform: scale(0.98); }
        
        .btn-racing { background: linear-gradient(135deg, #14b8a6, #2563eb); color: white; border: none; border-radius: 0.75rem; font-weight: 700; text-transform: none; box-shadow: 0 6px 16px rgba(20,184,166,0.25); transition: all 0.2s ease; }
        .btn-racing:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(20,184,166,0.3); filter: brightness(1.06); }
        .btn-racing:active { transform: scale(0.98); box-shadow: 0 4px 10px rgba(20,184,166,0.2); }
        .btn-racing span { display: inline-block; }
        #linkBtn { background: linear-gradient(135deg, #14b8a6, #2563eb) !important; }
        /* 本项目设计令牌 (DESIGN.md): 表面阶梯与强调色覆盖预编译工具类 */
        .dark .dark\\:bg-slate-900\\/70 { background-color: rgba(12,17,19,0.8) !important; }
        .dark .dark\\:bg-slate-900 { background-color: #0c1113 !important; }
        .dark .dark\\:bg-slate-800\\/50 { background-color: #11181b !important; }
        .dark .dark\\:bg-slate-800 { background-color: #11181b !important; }
        .dark .dark\\:bg-slate-700 { background-color: #162024 !important; }
        .dark .dark\\:border-slate-800 { border-color: #1f2a2f !important; }
        .dark .dark\\:border-slate-700 { border-color: #31424a !important; }
        .dark .dark\\:border-slate-600 { border-color: #31424a !important; }
        .dark .dark\\:bg-purple-900\\/30 { background-color: rgba(20,184,166,0.16) !important; }
        .dark .dark\\:text-purple-400 { color: #2dd4bf !important; }
        .bg-purple-100 { background-color: rgba(20,184,166,0.14) !important; }
        .text-purple-600 { color: #0d9488 !important; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

        /* 🔥 Toast 通知样式 */
        #toast-container {
            position: fixed;
            top: 24px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 12px;
            pointer-events: none;
        }
        .toast {
            pointer-events: auto;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 24px;
            border-radius: 16px;
            font-weight: 600;
            font-size: 14px;
            box-shadow: 0 15px 30px -5px rgba(0,0,0,0.2);
            backdrop-filter: blur(12px);
            animation: slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            max-width: 90vw;
            white-space: pre-line;
            text-align: left;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .toast-success { background-color: rgba(22, 163, 74, 0.9); color: white; } /* Green */
        .toast-error { background-color: rgba(220, 38, 38, 0.9); color: white; } /* Red */
        
        @keyframes slideIn {
            from { transform: translateY(-100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeOut {
            from { transform: translateY(0); opacity: 1; }
            to { transform: translateY(-20px); opacity: 0; }
        }
    
/* edgetunnel-ipfilter 结构层 (2.2): 双栏工作台 — 左地区栏 + 右结果区, 扁平卡片 */
main{max-width:1400px !important;display:grid !important;grid-template-columns:minmax(0,1fr) !important;gap:18px !important;align-items:start}
main > div{border-radius:10px !important;box-shadow:none !important}
main [class*="rounded-t-"]{border-top-left-radius:10px !important;border-top-right-radius:10px !important}
#regionGrid{grid-template-columns:repeat(auto-fill,minmax(118px,1fr)) !important;gap:6px !important;max-height:none;overflow:visible;padding-right:0}
.region-card{flex-direction:row !important;justify-content:flex-start !important;align-items:center !important;gap:9px !important;padding:7px 10px !important;border-radius:8px !important;text-align:left !important}
main > div:first-child .flex.gap-3{flex-wrap:wrap}
nav{border-bottom:1px solid #1f2a2f}
@media (max-width:920px){main{grid-template-columns:minmax(0,1fr) !important}#regionGrid{max-height:none}}
</style>
</head>
<body class="light min-h-screen pb-10" onclick="closeAllDropdowns(event)">
    <div id="toast-container"></div>

    <nav class="sticky top-0 z-50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center mb-6">
        <div class="flex items-center gap-3 font-bold text-xl">
        <div id="cfLogo" style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#14b8a6,#2563eb);display:flex;align-items:center;justify-content:center;font-size:19px;flex-shrink:0">🌏</div>
  <span class="text-slate-700 dark:text-slate-200 tracking-tight">Cloudflare Country-Specific IP Filter</span>
</div>

<div class="flex items-center gap-3">
<div class="relative">
<button id="githubBtn" 
onclick="window.open('https://github.com/dukangalex/Cloudflare-Country-Specific-IP-Filter', '_blank')"
class="group h-12 flex items-center rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-lg ring-1 ring-black/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all px-3.5 hover:px-5 hover:gap-3 ease-out duration-500 hover:duration-1000">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 -rotate-0 group-hover:-rotate-12 transition-transform duration-500 flex-shrink-0"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
<span class="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all ease-out whitespace-nowrap font-bold overflow-hidden duration-500 hover:duration-1000">GitHub项目地址</span>
</button>
</div>

            <div class="relative">
                <button onclick="toggleDropdown(event)" class="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
                </button>
                <div id="themeDropdown" class="dropdown-menu absolute right-0 top-14 w-28 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-1.5 flex flex-col gap-1 z-50 text-slate-700 dark:text-slate-200 ring-1 ring-black/5 dark:ring-white/10">
                    <button onclick="setThemeMode('system')" class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition text-sm font-bold theme-opt text-left" data-mode="system"><span class="text-lg">🖥️</span> <span>系统</span></button>
                    <button onclick="setThemeMode('light')" class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition text-sm font-bold theme-opt text-left" data-mode="light"><span class="text-lg">🌞</span> <span>浅色</span></button>
                    <button onclick="setThemeMode('dark')" class="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition text-sm font-bold theme-opt text-left" data-mode="dark"><span class="text-lg">🌙</span> <span>深色</span></button>
                </div>
            </div>

        </div>
    </nav>
    <main class="max-w-5xl mx-auto px-4 md:px-6 flex flex-col gap-6">
        <div class="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-[2rem] glass shadow-xl">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4">
                <div><h2 class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">全球节点</h2><p class="text-sm opacity-60">点击下方卡片选择要提取的地区 (按 IP 数量排序)</p></div>
                <div class="flex gap-3 w-full md:w-auto">
                <button onclick="randomSelect()" class="w-full md:w-auto px-6 py-2 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-xs font-bold text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-800/50 transition flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></svg> 随机摇号
                </button>
                <button onclick="selectAll()" class="w-full md:w-auto px-6 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-blue-600 hover:opacity-70 transition">全选/取消</button>
            </div>            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 p-2" id="regionGrid"><div class="col-span-full py-10 text-center animate-pulse text-slate-400">正在同步全球数据源...</div></div>
            <div id="loadingState" class="hidden text-center py-4 text-slate-500 animate-pulse text-sm mt-2"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin inline mr-2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 正在从全球边缘节点提取数据...</div>
        </div>
        
        <div class="bg-white dark:bg-slate-900 rounded-[2rem] glass shadow-xl border border-slate-200 dark:border-slate-800">
        <div class="rounded-t-[2rem] px-6 py-4 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 gap-4 relative">
        <div class="flex items-center gap-3 self-start sm:self-center"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg><span id="stats" class="text-xs font-bold opacity-40 uppercase tracking-tighter italic font-mono">WAITING FOR INPUT...</span></div>
        
        <div class="flex items-center gap-2 w-full sm:w-auto z-10">
                    <div class="flex items-center bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 shadow-sm mr-1 h-[34px]" title="单地区节点数量上限 (0为不限制)">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-slate-400 mr-2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg><span class="text-[10px] font-bold text-slate-400 mr-2 whitespace-nowrap">MAX</span>
                        <input id="limitInput" type="number" min="0" value="10" class="w-10 bg-transparent text-xs font-bold text-center outline-none text-slate-700 dark:text-slate-200 font-mono focus:text-blue-500 transition-colors" placeholder="0">
                    </div>
                    <button onclick="copy()" class="flex-1 sm:flex-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-600 transition flex items-center justify-center gap-2 shadow-sm"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class=""><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> 复制全部</button>
                    
                    <div class="relative group z-20 flex-1 sm:flex-none">
                        <button id="linkBtn" onclick="toggleLinkMenu(event)" class="w-full sm:w-auto bg-slate-900 dark:bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-xs hover:opacity-80 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class=""><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> API 地址</button>
                        
                        <div id="linkMenu" class="link-menu absolute top-full left-1/2 w-48 pt-4 z-50">
                            <div class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl p-2 flex flex-col gap-2 ring-1 ring-black/5">
                                <div class="text-[10px] text-center text-slate-400 font-bold uppercase tracking-wider py-1">请选择使用 API 的项目</div>
                                <button onclick="generateLink('CFnew')" class="btn-matrix h-10 text-xs flex items-center justify-center gap-2 w-full">
                                    <span>CFnew</span>
                                </button>
                                <button onclick="generateLink('edgetunnel')" class="btn-racing h-10 text-xs flex items-center justify-center gap-2 w-full">
                                    <span>edgetunnel</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="px-6 pt-5"><div class="text-[11px] font-bold opacity-50 uppercase tracking-wider mb-2">提取格式 · 选中地区后自动提取，点击可切换格式并重新提取</div><div class="grid grid-cols-2 gap-4">
              <button onclick="autoRun('cf_comma_short')" class="btn-matrix h-16 text-lg font-bold flex items-center justify-center gap-3 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg><span>CFnew</span></button>
              <button onclick="autoRun('cf_line_short')" class="btn-racing h-16 text-xl flex items-center justify-center gap-3 cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg><span>edgetunnel</span></button>
            </div></div>
            <textarea id="out" readonly class="w-full h-48 md:h-64 p-6 bg-transparent fira text-[13px] leading-relaxed outline-none resize-y text-slate-700 dark:text-slate-300 custom-scrollbar" placeholder="在上方选择地区后将自动提取，结果显示在这里..."></textarea>
        </div>
    </main>
    <footer class="mt-12 py-8 border-t border-slate-200 dark:border-slate-800">
        <div class="max-w-5xl mx-auto px-6 text-center">
            <div class="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-[13px] text-slate-500 dark:text-slate-400">
                <span class="font-bold opacity-80">特别鸣谢：</span>
                <a href="https://github.com/cmliu/edgetunnel" target="_blank" class="hover:text-blue-500 transition-colors flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg> CM大佬</a>
                <a href="https://github.com/byJoey/cfnew" target="_blank" class="hover:text-blue-500 transition-colors flex items-center gap-1"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg> Joey大佬</a>
                <a href="https://github.com/666OS/ClashMac" target="_blank" class="hover:text-blue-500 transition-colors flex items-center gap-1">ClashMac</a>
            </div>
            <p class="mt-3 text-[11px] opacity-60">数据来源：Cloudflare 优选 IP 数据集（cmliu 维护） · 完整致谢见项目仓库 README</p>
            <p class="mt-2 text-[11px] opacity-30 font-mono uppercase tracking-tighter">Powered by Cloudflare Workers · Icons by Lucide (ISC) · Tailwind CSS (MIT)</p>
        </div>
    </footer>
    <script>
        // 🔥 显示 Toast 通知函数
        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            
            // 图标
            const icon = type === 'success' ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
            
            toast.className = \`toast \${type === 'success' ? 'toast-success' : 'toast-error'}\`;
            toast.innerHTML = \`\${icon}<span>\${message}</span>\`;
            
            container.appendChild(toast);
            

            // 3秒后移除
            setTimeout(() => {
                toast.style.animation = 'fadeOut 0.3s forwards';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
        const slotAudio = new Audio("https://raw.githubusercontent.com/dukangalex/Cloudflare-Country-Specific-IP-Filter/main/Audio/%E8%80%81%E8%99%8E%E6%9C%BA2%E7%A7%92.mp3");
        slotAudio.preload = 'auto';
        slotAudio.volume = 1;

        function getFlag(code) {
            if(code === 'TW') return '🇹🇼';
            if(code === 'UK') return '🇬🇧';
            const codePoints = code.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
            return String.fromCodePoint(...codePoints);
        }
        const regionMap = ${JSON.stringify(REGION_MAP)};
        let selected = []; let fmt = 'line'; let allRegions = [];
        let curFmt = 'cf_line_short'; let runTimer = null;
        function scheduleRun() {
            clearTimeout(runTimer);
            runTimer = setTimeout(() => {
                if (selected.length) { autoRun(curFmt, true); }
                else { document.getElementById('out').value = ''; document.getElementById('stats').innerText = 'WAITING FOR INPUT...'; }
            }, 450);
        }
        async function init() {
            try {
                const res = await fetch('?get_regions=1');
                allRegions = await res.json();
                allRegions = allRegions.filter(r => r !== 'CN');
                if(allRegions.length === 0) throw new Error('empty region list');
                const grid = document.getElementById('regionGrid');
                grid.innerHTML = allRegions.map(r => \`
                    <button onclick="toggle('\${r}')" id="r-\${r}" class="region-card p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 flex flex-col items-center gap-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50 cursor-pointer">
                        <span class="text-xl">\${getFlag(r)}</span><span class="text-[10px] font-bold opacity-70">\${regionMap[r] || r}</span>
                    </button>\`).join('');
                
            } catch(e) {
                console.error(e);
                document.getElementById('regionGrid').innerHTML = '<div class="col-span-full py-10 text-center text-red-400 font-bold">数据源加载失败, 请稍后刷新页面重试</div>';
            }
        }
        function toggle(r) {
            const el = document.getElementById('r-' + r);
            if(!el) return;
            if(selected.includes(r)) { selected = selected.filter(i => i !== r); el.classList.remove('active'); } 
            else { selected.push(r); el.classList.add('active'); }
            scheduleRun();
        }
        function selectAll() {
            if(selected.length === allRegions.length) { selected = []; document.querySelectorAll('.region-card').forEach(el => el.classList.remove('active')); } 
            else { selected = [...allRegions]; document.querySelectorAll('.region-card').forEach(el => el.classList.add('active')); }
            scheduleRun();
        }
        async function autoRun(format, auto) {
            fmt = format; curFmt = format;
            const btns = document.querySelectorAll('.btn-matrix, .btn-racing');
            btns.forEach(b => b.style.opacity = '0.5'); btns.forEach(b => b.style.pointerEvents = 'none');
            document.getElementById('loadingState').classList.remove('hidden');
            await fetchIps(auto);
            btns.forEach(b => b.style.opacity = '1'); btns.forEach(b => b.style.pointerEvents = 'auto');
            document.getElementById('loadingState').classList.add('hidden');
        }
        async function fetchIps(auto) {
            if(selected.length === 0) { if(!auto) showToast('请至少选择一个地区！', 'error'); return; }
            try {
                const limitVal = parseInt(document.getElementById('limitInput').value, 10);
                const limit = Number.isFinite(limitVal) && limitVal > 0 ? limitVal : 0;
                const res = await fetch(\`?api=1&region=\${selected.join(',')}&format=\${fmt}&limit=\${limit}\`);
                const data = await res.text();
                document.getElementById('out').value = data;
                const isComma = fmt.includes('comma') || fmt === 'comma';
                const count = data ? (isComma ? data.split(',').length : data.trim().split('\\n').length) : 0;
                document.getElementById('stats').innerText = \`SUCCESS: \${count} NODES FOUND\`;
                if(!auto) document.getElementById('out').scrollIntoView({ behavior: 'smooth', block: 'center' });
                showToast(\`成功获取 \${count} 个节点 IP\`, 'success');
            } catch(e) { showToast('获取数据失败，请重试', 'error'); console.error(e); }
        }
        async function copy() {
            const out = document.getElementById('out');
            if(!out.value) { showToast('没有内容可复制', 'error'); return; }
            try {
                await navigator.clipboard.writeText(out.value);
                showToast('内容已复制到剪贴板', 'success');
            } catch(e) {
                out.select();
                try {
                    document.execCommand('copy');
                    showToast('内容已复制到剪贴板', 'success');
                } catch(e2) {
                    showToast('自动复制失败, 请长按/右键手动复制', 'error');
                }
            }
        }
        // 🎰 随机摇号功能
        async function randomSelect() {
            selected = [];
            document.querySelectorAll('.region-card').forEach(el => el.classList.remove('active'));
            
            try {
                slotAudio.currentTime = 0;
                slotAudio.play().catch(() => {});
            } catch(e) { console.error(e); }

            const minSelect = 1;
            const maxSelect = Math.min(30, allRegions.length);
            const finalCount = Math.floor(Math.random() * (maxSelect - minSelect + 1)) + minSelect;
            
            const duration = 2000; 
            const intervalTime = 100; 
            const startTime = Date.now();
            
            const btn = document.querySelector('button[onclick="randomSelect()"]');
            const originalHtml = btn.innerHTML;
            
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 摇号中...';
            btn.disabled = true;

            const interval = setInterval(() => {
                document.querySelectorAll('.region-card.active').forEach(el => el.classList.remove('active'));
                
                const tempIndices = new Set();
                while(tempIndices.size < finalCount) {
                    tempIndices.add(Math.floor(Math.random() * allRegions.length));
                }
                
                tempIndices.forEach(idx => {
                    const r = allRegions[idx];
                    const el = document.getElementById('r-' + r);
                    if(el) el.classList.add('active');
                });

                if (Date.now() - startTime > duration) {
                    clearInterval(interval);
                    finalizeSelection(finalCount);
                    btn.innerHTML = originalHtml;
                    btn.disabled = false;
                    
                }
            }, intervalTime);
        }

        function finalizeSelection(count) {
            document.querySelectorAll('.region-card.active').forEach(el => el.classList.remove('active'));
            selected = [];
            const finalIndices = new Set();
            while(finalIndices.size < count) {
                finalIndices.add(Math.floor(Math.random() * allRegions.length));
            }
            finalIndices.forEach(idx => {
                const r = allRegions[idx];
                toggle(r);
            });
            
            showToast('🎰 欧皇附体！随机选中了 ' + count + ' 个地区', 'success');
        }
        // 移动端点击切换菜单
        function toggleLinkMenu(e) {
            e.stopPropagation();
            document.getElementById('linkMenu').classList.toggle('open');
        }

        // 生成特定格式的链接并复制
        function generateLink(type) {
            if(selected.length === 0) { showToast('请先选择地区！', 'error'); return; }
            const limitVal = document.getElementById('limitInput').value;
            const limit = parseInt(limitVal) || 0;
            
            // 构建链接 (使用 - 分隔)
            let url = \`\${window.location.origin}/\${type}/\${selected.join('-')}\`;
            
            if (limit > 0) { url += \`?limit=\${limit}\`; }
            
            navigator.clipboard.writeText(url);
            
            let msg = \`【\${type}】订阅地址已复制到剪贴板\`;
            if(limit > 0) msg += \`\\n(已限制单地区最大 \${limit} 个节点)\`;
            
            showToast(msg, 'success');
            
            // 关闭菜单
            document.getElementById('linkMenu').classList.remove('open');
        }

        let currentThemeMode = localStorage.getItem('themeMode') || 'system';
        function applyTheme() {
            let isDark = false;
            if (currentThemeMode === 'system') { isDark = window.matchMedia('(prefers-color-scheme: dark)').matches; } 
            else { isDark = currentThemeMode === 'dark'; }
            document.documentElement.classList.toggle('dark', isDark); document.body.classList.toggle('dark', isDark); document.body.classList.toggle('light', !isDark);
            document.querySelectorAll('.theme-opt').forEach(btn => {
                if(btn.dataset.mode === currentThemeMode) { btn.classList.add('text-blue-600', 'dark:text-blue-400', 'bg-slate-100', 'dark:bg-slate-700'); } 
                else { btn.classList.remove('text-blue-600', 'dark:text-blue-400', 'bg-slate-100', 'dark:bg-slate-700'); }
            });
        }
        function setThemeMode(mode) { currentThemeMode = mode; localStorage.setItem('themeMode', mode); applyTheme(); document.getElementById('themeDropdown').classList.remove('open'); }
        function toggleDropdown(e) { e.stopPropagation(); document.getElementById('themeDropdown').classList.toggle('open'); }
        
        // 全局点击关闭所有菜单
        function closeAllDropdowns(e) { 
            document.getElementById('themeDropdown').classList.remove('open');
            document.getElementById('linkMenu').classList.remove('open');
        }
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { if(currentThemeMode === 'system') applyTheme(); });
        applyTheme(); init(); 
    </script>
</body>
</html>
    `;
    return _htmlCache;
}
