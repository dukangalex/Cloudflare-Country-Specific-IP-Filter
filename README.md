<div align="center">
  <img src="https://raw.githubusercontent.com/666OS/ClashMac/refs/heads/main/assets/cat.svg" width="150" alt="ClashMac Cat Logo" style="pointer-events: none; user-select: none;">

  <h1>Cloudflare Country-Specific IP Filter</h1>

  <p>
    Filter Cloudflare preferred IPs by country/region, ready to paste into CFnew / edgetunnel.<br>
    筛选指定国家/地区的 Cloudflare 优选 IP，输出可直接用于 CFnew / edgetunnel。
  </p>

  <p style="color: #ff4d4f; font-weight: bold; margin-bottom: 20px;">
    此项目完全公益性质，🚫 禁止商用，请遵守当地法律法规使用，建议绑定自定义域<br>
    Non-profit project. No commercial use. Please comply with local laws and regulations; binding a custom domain is recommended.
  </p>

  <div style="margin-bottom: 20px;">
    <span style="font-weight: bold; font-size: 16px; vertical-align: middle; margin-right: 8px;">特别鸣谢 / Credits:</span><a href="https://github.com/cmliu/edgetunnel" target="_blank" style="display: inline-block; text-decoration: none;"><img src="https://img.shields.io/badge/GitHub-CM%E5%A4%A7%E4%BD%AC-181717?style=flat-square&logo=github&logoColor=white" alt="CM大佬" style="vertical-align: -3px;"></a><span style="margin: 0 5px;"></span><a href="https://github.com/byJoey/cfnew" target="_blank" style="display: inline-block; text-decoration: none;"><img src="https://img.shields.io/badge/GitHub-Joey%E5%A4%A7%E4%BD%AC-181717?style=flat-square&logo=github&logoColor=white" alt="Joey大佬" style="vertical-align: -3px;"></a><span style="margin: 0 5px;"></span><a href="https://github.com/666OS/ClashMac" target="_blank" style="display: inline-block; text-decoration: none;"><img src="https://img.shields.io/badge/GitHub-6%E4%BD%AC-181717?style=flat-square&logo=github&logoColor=white" alt="ClashMac" style="vertical-align: -3px;"></a>
  </div>

  <img src="Image/Light.png" width="100%" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
  <br><br>
  <img src="Image/Dark.png" width="100%" style="border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

</div>

## Features / 功能

- **Filter by region** — pick one or more countries/regions and get only their Cloudflare IPs. 按地区多选提取 IP。
- **Two ready-made styles** — CFnew style (flag + region name + superscript index) and edgetunnel style. 两种现成命名风格。
- **Per-region limit** — cap how many IPs each region contributes; sampling is unbiased random. 单地区数量上限，随机抽样无偏。
- **Base64 output** — append `base64=1` for subscription-style consumers. 支持 base64 输出。
- **Web UI** — region cards sorted by IP count, dark/light themes, one-click copy of API links. 网页界面，地区按 IP 数量排序，一键复制 API 地址。
- **Fast & resilient** — the upstream list (~16k lines) is fetched, parsed and cached for 5 minutes instead of on every request; if the upstream hiccups, the last good dataset is served. 上游数据缓存 5 分钟，上游抖动时自动降级用旧数据。

Data source / 数据源: [zip.cm.edu.kg/all.txt](https://zip.cm.edu.kg/all.txt) (format: `IP:PORT#CC` per line). Entries without a valid two-letter region code (e.g. `#Unknown`) are skipped. 无合法地区代码的条目会被跳过。

## Deployment / 部署

Single file, zero dependencies. 任选一种：

1. **Workers console** — create a Worker, paste the whole `_worker.js`, deploy. 在 Cloudflare 控制台新建 Worker，粘贴 `_worker.js` 全部内容后部署。
2. **Pages** — put `_worker.js` in your project root; Pages picks it up automatically. 放到 Pages 项目根目录即可。
3. **Wrangler** — this repo ships a `wrangler.toml`:

   ```bash
   npx wrangler deploy
   ```

Binding a custom domain is recommended. 建议绑定自定义域名。

## Usage / 使用

### Web UI / 网页

Open the deployed root URL, click region cards to select, then press **CFnew** or **edgetunnel** to generate the list. The **MAX** box caps IPs per region, and **API 地址** copies a reusable link.

打开部署后的根地址，点选地区卡片，再点 CFnew 或 edgetunnel 按钮生成；MAX 是单地区上限；「API 地址」可复制可复用的链接。

### Path API / 路径式接口

```
/CFnew/<regions>?limit=N&base64=1
/edgetunnel/<regions>?limit=N&base64=1
```

- `<regions>`: two-letter codes joined by `-` or `,`, e.g. `JP-US` or `JP,US`. 地区代码用 `-` 或 `,` 连接。
- `CFnew` outputs `cf_line_short` format; `edgetunnel` outputs `line` format. 两种路径对应各自项目的格式。

Examples / 示例:

```
https://your-domain.example/CFnew/JP-US?limit=10
https://your-domain.example/edgetunnel/JP-HK-SG?limit=5&base64=1
```

### Query API / 参数式接口

```
https://your-domain.example/?api=1&region=JP,US&format=cf_line_short&limit=10
```

| Parameter 参数 | Values 取值 | Description 说明 |
| --- | --- | --- |
| `region` | `JP,US` | Comma-separated region codes. 地区代码，逗号分隔 |
| `format` | see below | Output format. 输出格式 |
| `limit` | `0` = unlimited | Max IPs per region. 单地区上限，0 为不限制 |
| `base64` | `1` / `0` | Base64-encode the output. 是否 base64 编码 |

| Format | Sample output 示例 |
| --- | --- |
| `line` (edgetunnel) | `1.2.3.4:443#🇯🇵 日本 1.2.3.4:443` |
| `cf_line` | `1.2.3.4:443#🇯🇵 日本¹-443` |
| `cf_line_short` | `1.2.3.4:443#🇯🇵 日本¹` |
| `cf_comma_short` | same as above, comma-separated. 同上，逗号分隔 |

Region list endpoint / 地区列表接口: `/?get_regions=1` returns a JSON array of region codes sorted by IP count descending. 返回按 IP 数量降序的地区代码 JSON 数组。

## Development / 开发

```bash
npm test   # offline unit tests (upstream is mocked), Node >= 18
```

Tests cover region parsing, limit handling, output formats, base64 round-trip and upstream-failure behaviour. 测试覆盖地区解析、limit、输出格式、base64 与上游故障行为。

## Notes / 说明

- Open source; forks are welcome, please keep the credits link. 已开源，支持二创，二创请保留鸣谢链接。
- The region list intentionally excludes entries that cannot be attributed to a country/region. 无法归属地区的条目不纳入筛选。
