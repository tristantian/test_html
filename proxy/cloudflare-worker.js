export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/quote') {
      return handleQuote(url);
    }

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, service: 'fund-proxy' });
    }

    return jsonResponse({ ok: false, message: 'Not Found' }, 404);
  }
};

async function handleQuote(url) {
  const code = (url.searchParams.get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ ok: false, message: '基金代码必须是 6 位数字' }, 400);
  }

  try {
    const [estimate, official] = await Promise.all([
      fetchEstimate(code),
      fetchOfficialNav(code)
    ]);

    const name = estimate?.name || `基金 ${code}`;
    const marketPhase = getChinaMarketPhase();
    const selected = selectBestQuote(estimate, official, marketPhase);

    return jsonResponse({
      ok: true,
      code,
      name,
      marketPhase,
      estimate,
      official,
      selected
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      message: error.message || '代理请求失败'
    }, 500);
  }
}

async function fetchEstimate(code) {
  const callback = `cb${Date.now()}`;
  const response = await fetch(`https://fund.eastmoney.com/data/funddataforgznew.aspx?cb=${callback}&fc=${code}&t=basewap`, {
    headers: {
      'Referer': 'https://fund.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const text = await response.text();
  const data = parseJsonp(text);
  if (!data) return null;

  return {
    source: 'intraday-estimate',
    fundcode: data.fundcode || code,
    name: data.name || `基金 ${code}`,
    dwjz: toNumberString(data.dwjz),
    gsz: toNumberString(data.gsz || data.dwjz),
    gszzl: toNumberString(data.gszzl),
    jzrq: data.jzrq || '',
    gztime: data.gztime || ''
  };
}

async function fetchOfficialNav(code) {
  const callback = `nav${Date.now()}`;
  const response = await fetch(`https://api.fund.eastmoney.com/f10/lsjz?callback=${callback}&fundCode=${code}&pageIndex=1&pageSize=1&startDate=&endDate=&_=${Date.now()}`, {
    headers: {
      'Referer': 'https://fundf10.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  const text = await response.text();
  const data = parseJsonp(text);
  const latest = data?.Data?.LSJZList?.[0];
  if (!latest || !latest.DWJZ) return null;

  return {
    source: 'official-nav',
    fundcode: code,
    dwjz: toNumberString(latest.DWJZ),
    gsz: toNumberString(latest.DWJZ),
    gszzl: toNumberString(latest.JZZZL),
    jzrq: latest.FSRQ || '',
    gztime: ''
  };
}

function selectBestQuote(estimate, official, marketPhase) {
  if (marketPhase === 'after_close' && official && isTodayInChina(official.jzrq)) {
    return official;
  }

  if (marketPhase === 'trading' && estimate) {
    return estimate;
  }

  return official || estimate || null;
}

function getChinaMarketPhase(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
  const hhmm = hour * 100 + minute;

  if (hhmm >= 930 && hhmm < 1500) return 'trading';
  if (hhmm >= 1500) return 'after_close';
  return 'before_open';
}

function getChinaDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function isTodayInChina(dateString) {
  return dateString === getChinaDateString();
}

function parseJsonp(payload) {
  const start = payload.indexOf('(');
  const end = payload.lastIndexOf(')');
  if (start < 0 || end < 0 || end <= start) return null;

  try {
    return JSON.parse(payload.slice(start + 1, end));
  } catch {
    return null;
  }
}

function toNumberString(value) {
  if (value === null || value === undefined || value === '') return '0';
  return String(value);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
