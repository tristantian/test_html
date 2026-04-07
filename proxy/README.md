# Fund Proxy

这个目录提供一个可部署的轻量代理层，用来解决 GitHub Pages 无法直接访问东财盘中估值接口的问题。

## 为什么需要代理

东财盘中估值接口：

`https://fund.eastmoney.com/data/funddataforgznew.aspx`

虽然返回的是 `callback({...})` 形式的数据，但响应头是 `text/html`，在 GitHub Pages 这种纯静态前端里不能稳定当作脚本执行，因此会出现“请求失败”。

## 推荐部署方式

推荐部署到 Cloudflare Workers。

入口文件：

- `cloudflare-worker.js`

## Worker 路由

- `GET /health`
- `GET /quote?code=025209`

## 返回逻辑

- 盘中：优先返回东财盘中估值
- 收盘后：如果当天官方净值已发布，优先返回官方净值
- 兜底：官方净值和估值二选一

## 前端接入

在 [main.js](/home/shentianhao/test_html/main.js) 中有：

```js
const FUND_PROXY_BASE = '';
```

把它改成你的 Worker 地址，例如：

```js
const FUND_PROXY_BASE = 'https://your-worker.your-subdomain.workers.dev';
```

也可以在页面运行前注入：

```html
<script>
  window.FUND_PROXY_BASE = 'https://your-worker.your-subdomain.workers.dev';
</script>
```

## 示例返回

```json
{
  "ok": true,
  "code": "025209",
  "name": "永赢先锋半导体智选混合发起C",
  "marketPhase": "after_close",
  "selected": {
    "source": "official-nav",
    "dwjz": "1.6118",
    "gsz": "1.6118",
    "gszzl": "1.73",
    "jzrq": "2026-04-07",
    "gztime": ""
  }
}
```
