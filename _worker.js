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
    <link rel="icon" href="https://www.cloudflare.com/favicon.ico" type="image/x-icon">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = { darkMode: 'class' }
    </script>
    <link rel="preconnect" href="https://cdn.tailwindcss.com">
    <link rel="preconnect" href="https://unpkg.com">
    <script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fira+Code&display=swap');
        body { font-family: 'Inter', sans-serif; transition: background 0.3s, color 0.3s; }
        .dark { background-color: #020617; color: #f8fafc; }
        .light { background-color: #f8fafc; color: #0f172a; }
        .glass { border: 1px solid rgba(150,150,150,0.1); }
        .region-card { transition: all 0.2s; border: 2px solid transparent; }
        .region-card.active { border-color: #2563eb !important; background-color: rgba(37,99,235,0.1) !important; transform: scale(1.05); font-weight: 700; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15); }
        .fira { font-family: 'Fira Code', monospace; }
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
        
        .btn-matrix { background-color: #000; color: #0f0; border: 1px solid #0f0; font-family: 'Courier New', monospace; border-radius: 0.75rem; box-shadow: 0 0 5px rgba(0, 255, 0, 0.5); text-shadow: 0 0 5px rgba(0, 255, 0, 0.8); transition: all 0.2s ease; letter-spacing: 2px; position: relative; overflow: hidden; }
        .btn-matrix:hover { background-color: #001a00; box-shadow: 0 0 20px rgba(0, 255, 0, 0.8), inset 0 0 10px rgba(0, 255, 0, 0.4); transform: translateY(-2px); }
        .btn-matrix:active { transform: scale(0.98); }
        
        .btn-racing { background: linear-gradient(135deg, #ff8c00, #ff4500); color: white; border: none; border-radius: 0.75rem; font-style: italic; font-weight: 800; text-transform: none; box-shadow: 5px 5px 0px rgba(0,0,0,0.2); transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .btn-racing:hover { transform: scale(1.02) translate(-2px, -2px); box-shadow: 8px 8px 0px rgba(0,0,0,0.2); filter: brightness(1.1); }
        .btn-racing:active { transform: scale(0.98); box-shadow: 2px 2px 0px rgba(0,0,0,0.2); }
        .btn-racing span { display: inline-block; transform: skew(15deg); }
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
    </style>
</head>
<body class="light min-h-screen pb-10" onclick="closeAllDropdowns(event)">
    <div id="toast-container"></div>

    <nav class="sticky top-0 z-50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center mb-6">
        <div class="flex items-center gap-3 font-bold text-xl">
        <div id="cfLogo" class="flex items-center justify-center w-9 h-9">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 117" class="w-9 h-9">
    <path fill="#fbad41" d="M205.52 50.813c-.858 0-1.705.03-2.551.058q-.207.012-.398.094a1.42 1.42 0 0 0-.92.994l-3.628 12.672c-1.565 5.449-.983 10.48 1.646 14.174c2.41 3.416 6.42 5.421 11.289 5.655l19.679 1.194c.585.03 1.092.312 1.4.776a1.92 1.92 0 0 1 .2 1.692a2.5 2.5 0 0 1-2.134 1.662l-20.448 1.193c-11.11.515-23.062 9.58-27.255 20.633l-1.474 3.9a1.092 1.092 0 0 0 .967 1.49h70.425a1.87 1.87 0 0 0 1.81-1.365A51.2 51.2 0 0 0 256 101.828c0-28.16-22.582-50.984-50.449-50.984"/>
    <path fill="#f6821f" d="m174.782 115.362l1.303-4.583c1.568-5.449.987-10.48-1.639-14.173c-2.418-3.417-6.424-5.422-11.296-5.656l-92.312-1.193a1.82 1.82 0 0 1-1.459-.776a1.92 1.92 0 0 1-.203-1.693a2.5 2.5 0 0 1 2.154-1.662l93.173-1.193c11.063-.511 23.015-9.58 27.208-20.633l5.313-14.04c.214-.596.27-1.238.156-1.86C191.126 20.51 166.91 0 137.96 0C111.269 0 88.626 17.403 80.5 41.596a27 27 0 0 0-19.156-5.359C48.549 37.524 38.25 47.946 36.979 60.88a27.9 27.9 0 0 0 .702 9.642C16.773 71.145 0 88.454 0 109.726c0 1.923.137 3.818.413 5.667c.115.897.879 1.57 1.783 1.568h170.48a2.22 2.22 0 0 0 2.106-1.63"/>
  </svg>
</div>
  <span class="text-slate-700 dark:text-slate-200 tracking-tight">Cloudflare Country-Specific IP Filter</span>
</div>

<div class="flex items-center gap-3">
<div class="relative">
<button id="githubBtn" 
onclick="window.open('https://github.com/dukangalex/Cloudflare-Country-Specific-IP-Filter', '_blank')"
class="group h-12 flex items-center rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-lg ring-1 ring-black/5 dark:ring-white/10 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all px-3.5 hover:px-5 hover:gap-3 ease-out duration-500 hover:duration-1000">
<i data-lucide="github" class="w-5 h-5 -rotate-0 group-hover:-rotate-12 transition-transform duration-500 flex-shrink-0"></i>
<span class="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all ease-out whitespace-nowrap font-bold overflow-hidden duration-500 hover:duration-1000">GitHub项目地址</span>
</button>
</div>

            <div class="relative">
                <button onclick="toggleDropdown(event)" class="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                    <i data-lucide="sun" class="w-6 h-6"></i>
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
                    <i data-lucide="dices" class="w-4 h-4"></i> 随机摇号
                </button>
                <button onclick="selectAll()" class="w-full md:w-auto px-6 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-blue-600 hover:opacity-70 transition">全选/取消</button>
            </div>            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 p-2" id="regionGrid"><div class="col-span-full py-10 text-center animate-pulse text-slate-400">正在同步全球数据源...</div></div>
            <div class="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
              <button onclick="autoRun('cf_comma_short')" class="btn-matrix h-16 text-lg font-bold flex items-center justify-center gap-3 cursor-pointer"><i data-lucide="terminal-square" class="w-6 h-6"></i><span>CFnew</span></button>
              <button onclick="autoRun('cf_line_short')" class="btn-racing h-16 text-xl flex items-center justify-center gap-3 cursor-pointer"><i data-lucide="zap" class="w-6 h-6"></i><span>edgetunnel</span></button>
            </div>
            <div id="loadingState" class="hidden text-center py-4 text-slate-500 animate-pulse text-sm mt-2"><i data-lucide="loader-2" class="animate-spin inline mr-2"></i> 正在从全球边缘节点提取数据...</div>
        </div>
        
        <div class="bg-white dark:bg-slate-900 rounded-[2rem] glass shadow-xl border border-slate-200 dark:border-slate-800">
        <div class="rounded-t-[2rem] px-6 py-4 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-center bg-slate-50/50 dark:bg-slate-800/50 gap-4 relative">
        <div class="flex items-center gap-3 self-start sm:self-center"><i data-lucide="terminal" size="16" class="text-blue-500"></i><span id="stats" class="text-xs font-bold opacity-40 uppercase tracking-tighter italic font-mono">WAITING FOR INPUT...</span></div>
        
        <img src="https://github.com/666OS/ClashMac/raw/refs/heads/main/assets/cat.svg" class="hidden sm:block absolute left-1/2 -translate-x-1/2 -bottom-3 h-[110px] w-auto opacity-90 hover:scale-110 transition-transform duration-300 pointer-events-none">
        
        <div class="flex items-center gap-2 w-full sm:w-auto z-10">
                    <div class="flex items-center bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 shadow-sm mr-1 h-[34px]" title="单地区节点数量上限 (0为不限制)">
                        <i data-lucide="filter" class="w-3.5 h-3.5 text-slate-400 mr-2"></i><span class="text-[10px] font-bold text-slate-400 mr-2 whitespace-nowrap">MAX</span>
                        <input id="limitInput" type="number" min="0" value="10" class="w-10 bg-transparent text-xs font-bold text-center outline-none text-slate-700 dark:text-slate-200 font-mono focus:text-blue-500 transition-colors" placeholder="0">
                    </div>
                    <button onclick="copy()" class="flex-1 sm:flex-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-600 transition flex items-center justify-center gap-2 shadow-sm"><i data-lucide="copy" size="14"></i> 复制全部</button>
                    
                    <div class="relative group z-20 flex-1 sm:flex-none">
                        <button id="linkBtn" onclick="toggleLinkMenu(event)" class="w-full sm:w-auto bg-slate-900 dark:bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-xs hover:opacity-80 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"><i data-lucide="link" size="14"></i> API 地址</button>
                        
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
            <textarea id="out" readonly class="w-full h-48 md:h-64 p-6 bg-transparent fira text-[13px] leading-relaxed outline-none resize-y text-slate-700 dark:text-slate-300 custom-scrollbar" placeholder="点击上方按钮提取，结果将显示在这里..."></textarea>
        </div>
    </main>
    <footer class="mt-12 py-8 border-t border-slate-200 dark:border-slate-800">
        <div class="max-w-5xl mx-auto px-6 text-center">
            <div class="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-[13px] text-slate-500 dark:text-slate-400">
                <span class="font-bold opacity-80">特别鸣谢：</span>
                <a href="https://github.com/cmliu/edgetunnel" target="_blank" class="hover:text-blue-500 transition-colors flex items-center gap-1"><i data-lucide="github" class="w-3.5 h-3.5"></i> CM大佬</a>
                <a href="https://github.com/byJoey/cfnew" target="_blank" class="hover:text-blue-500 transition-colors flex items-center gap-1"><i data-lucide="github" class="w-3.5 h-3.5"></i> Joey大佬</a>
            </div>
            <p class="mt-4 text-[11px] opacity-30 font-mono uppercase tracking-tighter">Powered by Cloudflare Workers & Lucide Icons</p>
        </div>
    </footer>
    <script>
        // 🔥 显示 Toast 通知函数
        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            
            // 图标
            const icon = type === 'success' ? '<i data-lucide="check-circle-2" class="w-5 h-5"></i>' : '<i data-lucide="alert-circle" class="w-5 h-5"></i>';
            
            toast.className = \`toast \${type === 'success' ? 'toast-success' : 'toast-error'}\`;
            toast.innerHTML = \`\${icon}<span>\${message}</span>\`;
            
            container.appendChild(toast);
            lucide.createIcons();

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
                lucide.createIcons();
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
        }
        function selectAll() {
            if(selected.length === allRegions.length) { selected = []; document.querySelectorAll('.region-card').forEach(el => el.classList.remove('active')); } 
            else { selected = [...allRegions]; document.querySelectorAll('.region-card').forEach(el => el.classList.add('active')); }
        }
        async function autoRun(format) {
            fmt = format;
            const btns = document.querySelectorAll('.btn-matrix, .btn-racing');
            btns.forEach(b => b.style.opacity = '0.5'); btns.forEach(b => b.style.pointerEvents = 'none');
            document.getElementById('loadingState').classList.remove('hidden');
            await fetchIps();
            btns.forEach(b => b.style.opacity = '1'); btns.forEach(b => b.style.pointerEvents = 'auto');
            document.getElementById('loadingState').classList.add('hidden');
        }
        async function fetchIps() {
            if(selected.length === 0) { showToast('请至少选择一个地区！', 'error'); return; }
            try {
                const limitVal = parseInt(document.getElementById('limitInput').value, 10);
                const limit = Number.isFinite(limitVal) && limitVal > 0 ? limitVal : 0;
                const res = await fetch(\`?api=1&region=\${selected.join(',')}&format=\${fmt}&limit=\${limit}\`);
                const data = await res.text();
                document.getElementById('out').value = data;
                const isComma = fmt.includes('comma') || fmt === 'comma';
                const count = data ? (isComma ? data.split(',').length : data.trim().split('\\n').length) : 0;
                document.getElementById('stats').innerText = \`SUCCESS: \${count} NODES FOUND\`;
                document.getElementById('out').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
            
            btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> 摇号中...';
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
                    lucide.createIcons();
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
        applyTheme(); init(); lucide.createIcons();
    </script>
</body>
</html>
    `;
    return _htmlCache;
}
