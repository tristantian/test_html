/**
 * 基金实时估值工具 - 主逻辑
 * 功能：添加基金、实时估值、盈亏记录、收益曲线
 * 数据存储：localStorage
 */

// ==================== 数据管理 ====================

const STORAGE_KEYS = {
  FUNDS: 'fund_portfolio',
  HISTORY: 'fund_history',
  SNAPSHOTS: 'fund_snapshots'
};

function toNumber(value, fallback = 0) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTabId() {
  return document.querySelector('.tab-btn.active')?.dataset.tab || 'portfolio';
}

function refreshCurrentTabViews() {
  const activeTab = getCurrentTabId();
  if (activeTab === 'yield-curve') {
    updateYieldChart(getActiveChartRange());
    updateAllocationChart();
  } else if (activeTab === 'forecast') {
    refreshPredictionFundOptions();
  } else if (activeTab === 'history') {
    renderHistory();
  }
}

function getActiveChartRange() {
  const activeBtn = document.querySelector('.chart-controls [data-range].active');
  return activeBtn ? Number.parseInt(activeBtn.dataset.range, 10) || 7 : 7;
}

// 获取持仓列表
function getFunds() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.FUNDS)) || [];
  } catch {
    return [];
  }
}

// 保存持仓列表
function saveFunds(funds) {
  localStorage.setItem(STORAGE_KEYS.FUNDS, JSON.stringify(funds));
}

// 获取历史快照
function getSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.SNAPSHOTS)) || [];
  } catch {
    return [];
  }
}

// 保存历史快照
function saveSnapshots(snapshots) {
  localStorage.setItem(STORAGE_KEYS.SNAPSHOTS, JSON.stringify(snapshots));
}

// ==================== 标签页切换 ====================

document.addEventListener('DOMContentLoaded', () => {
  // 标签页切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // 更新按钮状态
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // 更新内容区域
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
      
      // 切换到特定标签时执行操作
      if (tabId === 'yield-curve') {
        updateYieldChart(7);
        updateAllocationChart();
      } else if (tabId === 'forecast') {
        refreshPredictionFundOptions();
      } else if (tabId === 'history') {
        renderHistory();
      }
    });
  });

  // 设置默认日期
  document.getElementById('buyDate').valueAsDate = new Date();

  // 初始化页面
  renderFundList();
  updateSummary();
  refreshPredictionFundOptions();
  renderHistory();
});

// ==================== 基金查询 (东财接口) ====================

// 临时存储查询到的基金信息
let currentSearchResult = null;
let fundCatalogPromise = null;
const pingzhongDataCache = new Map();
const FUND_PROXY_BASE = '';

function loadScriptJsonp(src, callbackPrefix) {
  return new Promise((resolve, reject) => {
    const callbackName = `${callbackPrefix}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const script = document.createElement('script');
    
    window[callbackName] = function(data) {
      resolve(data);
      delete window[callbackName];
      document.head.removeChild(script);
    };
    
    script.onerror = function() {
      reject(new Error('请求失败'));
      delete window[callbackName];
      document.head.removeChild(script);
    };

    script.src = src(callbackName);
    document.head.appendChild(script);
    
    // 超时处理
    setTimeout(() => {
      if (window[callbackName]) {
        reject(new Error('请求超时'));
        delete window[callbackName];
        if (script.parentNode) document.head.removeChild(script);
      }
    }, 10000);
  });
}

function getFundProxyBase() {
  const runtimeValue = typeof window !== 'undefined' ? window.FUND_PROXY_BASE : '';
  return (runtimeValue || FUND_PROXY_BASE || '').trim().replace(/\/$/, '');
}

function loadEastmoneyFundCatalog() {
  if (fundCatalogPromise) return fundCatalogPromise;

  fundCatalogPromise = new Promise((resolve, reject) => {
    if (Array.isArray(window.r) && window.r.length > 0) {
      resolve(window.r);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://fund.eastmoney.com/js/fundcode_search.js?v=${Date.now()}`;
    script.onload = () => {
      if (Array.isArray(window.r)) {
        resolve(window.r);
      } else {
        reject(new Error('基金代码表加载失败'));
      }
    };
    script.onerror = () => reject(new Error('基金代码表请求失败'));
    document.head.appendChild(script);
  });

  return fundCatalogPromise;
}

async function lookupFundName(code) {
  try {
    const catalog = await loadEastmoneyFundCatalog();
    const matched = catalog.find(item => item[0] === code);
    return matched ? matched[2] : `基金 ${code}`;
  } catch {
    return `基金 ${code}`;
  }
}

function resetPingzhongGlobals() {
  delete window.fS_name;
  delete window.fS_code;
  delete window.Data_netWorthTrend;
}

function loadEastmoneyPingzhongData(code) {
  if (pingzhongDataCache.has(code)) {
    return Promise.resolve(pingzhongDataCache.get(code));
  }

  return new Promise((resolve, reject) => {
    resetPingzhongGlobals();
    const script = document.createElement('script');
    script.src = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;

    script.onload = () => {
      const payload = {
        code: window.fS_code || code,
        name: window.fS_name || `基金 ${code}`,
        netWorthTrend: Array.isArray(window.Data_netWorthTrend) ? [...window.Data_netWorthTrend] : []
      };
      pingzhongDataCache.set(code, payload);
      script.remove();
      resolve(payload);
    };

    script.onerror = () => {
      script.remove();
      reject(new Error('基金历史数据请求失败'));
    };

    document.head.appendChild(script);
  });
}

function buildQuoteFromPingzhongData(pingzhongData) {
  const trend = pingzhongData?.netWorthTrend || [];
  const latest = trend.at(-1);
  if (!latest || !latest.y) return null;

  return {
    fundcode: pingzhongData.code,
    name: pingzhongData.name,
    dwjz: String(latest.y),
    gsz: String(latest.y),
    gszzl: String(latest.equityReturn ?? 0),
    jzrq: getLocalDateString(new Date(latest.x)),
    source: 'eastmoney-pingzhong'
  };
}

async function fetchFundHistory(code, pageSize = 30) {
  const pingzhongData = await loadEastmoneyPingzhongData(code);
  const trend = pingzhongData.netWorthTrend || [];
  return {
    Data: {
      LSJZList: trend.slice(-pageSize).map(item => ({
        FSRQ: getLocalDateString(new Date(item.x)),
        DWJZ: item.y,
        JZZZL: item.equityReturn
      }))
    }
  };
}

async function fetchFundQuote(code, fallbackName = '') {
  const proxyBase = getFundProxyBase();
  if (proxyBase) {
    return fetchFundQuoteByProxy(proxyBase, code, fallbackName);
  }

  const pingzhongData = await loadEastmoneyPingzhongData(code);
  const quote = buildQuoteFromPingzhongData(pingzhongData);
  if (!quote) return null;

  quote.name = fallbackName || quote.name || await lookupFundName(code);
  return quote;
}

async function fetchFundQuoteByProxy(proxyBase, code, fallbackName = '') {
  const response = await fetch(`${proxyBase}/quote?code=${encodeURIComponent(code)}`);
  if (!response.ok) {
    throw new Error(`代理请求失败(${response.status})`);
  }

  const payload = await response.json();
  if (!payload || !payload.selected) {
    throw new Error(payload?.message || '代理未返回基金数据');
  }

  return {
    fundcode: payload.code || code,
    name: fallbackName || payload.name || `基金 ${code}`,
    dwjz: String(payload.selected.dwjz ?? payload.selected.gsz ?? '0'),
    gsz: String(payload.selected.gsz ?? payload.selected.dwjz ?? '0'),
    gszzl: String(payload.selected.gszzl ?? '0'),
    jzrq: payload.selected.jzrq || payload.selected.gztime || '--',
    gztime: payload.selected.gztime || '',
    source: payload.selected.source || payload.marketPhase || 'proxy'
  };
}

// 查询基金
async function searchFund() {
  const code = document.getElementById('fundCode').value.trim();
  if (!code || code.length < 6) {
    showToast('请输入6位基金代码', 'warning');
    return;
  }

  showToast('正在查询基金信息...', '');
  
  try {
    const data = await fetchFundQuote(code);
    
    if (!data || !data.dwjz) {
      showToast('未找到该基金，请检查代码', 'error');
      return;
    }

    currentSearchResult = data;
    
    // 显示查询结果
    document.getElementById('fundSearchResult').style.display = 'block';
    document.getElementById('previewFundName').textContent = data.name || `基金 ${data.fundcode}`;
    document.getElementById('previewFundCode').textContent = data.fundcode;
    document.getElementById('previewNav').textContent = data.dwjz + ' 元 (' + data.jzrq + ')';
    document.getElementById('previewEstNav').textContent = data.gztime
      ? `${data.gsz} 元 (${data.gztime})`
      : `${data.gsz} 元 (东财最新净值)`;
    
    const changeVal = parseFloat(data.gszzl);
    const changeEl = document.getElementById('previewEstChange');
    changeEl.textContent = (changeVal >= 0 ? '+' : '') + data.gszzl + '%';
    changeEl.className = changeVal >= 0 ? 'profit-positive' : 'profit-negative';
    
    // 自动填入最新净值作为买入价参考
    document.getElementById('buyPrice').value = data.dwjz;
    
    if (data.source === 'official-nav') {
      showToast('查询成功，当前展示的是东财盘后官方净值', 'success');
    } else if (data.source === 'eastmoney-estimate' || data.source === 'intraday-estimate') {
      showToast('查询成功，当前展示的是东财盘中估值', 'success');
    } else {
      showToast('查询成功，当前展示的是东财最新净值', 'success');
    }
  } catch (err) {
    showToast('查询失败: ' + err.message, 'error');
  }
}

// ==================== 添加基金 ====================

function addFund() {
  if (!currentSearchResult) {
    showToast('请先查询基金', 'warning');
    return;
  }

  const buyPrice = parseFloat(document.getElementById('buyPrice').value);
  const buyShares = parseFloat(document.getElementById('buyShares').value);
  const buyDate = document.getElementById('buyDate').value;

  if (!buyPrice || buyPrice <= 0) {
    showToast('请输入有效的买入均价', 'warning');
    return;
  }
  if (!buyShares || buyShares <= 0) {
    showToast('请输入有效的持有份额', 'warning');
    return;
  }
  if (!buyDate) {
    showToast('请选择买入日期', 'warning');
    return;
  }

  const funds = getFunds();
  
  // 检查是否已存在
  const existIndex = funds.findIndex(f => f.code === currentSearchResult.fundcode);
  if (existIndex >= 0) {
    showToast('该基金已在持仓中，请在持仓列表中编辑', 'warning');
    return;
  }

  const newFund = {
    id: Date.now().toString(),
    code: currentSearchResult.fundcode,
    name: currentSearchResult.name,
    buyPrice: buyPrice,
    shares: buyShares,
    buyDate: buyDate,
    currentNav: parseFloat(currentSearchResult.dwjz),
    estNav: parseFloat(currentSearchResult.gsz),
    estChange: parseFloat(currentSearchResult.gszzl),
    lastUpdate: new Date().toLocaleString('zh-CN'),
    navDate: currentSearchResult.jzrq
  };

  funds.push(newFund);
  saveFunds(funds);
  recordDailySnapshot(true);

  // 重置表单
  currentSearchResult = null;
  document.getElementById('fundCode').value = '';
  document.getElementById('buyPrice').value = '';
  document.getElementById('buyShares').value = '';
  document.getElementById('fundSearchResult').style.display = 'none';

  showToast(`${newFund.name} 已添加到持仓！`, 'success');
  
  // 切换到持仓页
  document.querySelector('[data-tab="portfolio"]').click();
}

// ==================== 刷新估值 ====================

async function refreshAllFunds() {
  const funds = getFunds();
  if (funds.length === 0) {
    showToast('暂无持仓基金', 'warning');
    return;
  }

  showToast('正在刷新估值数据...', '');
  
  let successCount = 0;
  let failCount = 0;

  const results = await Promise.allSettled(
    funds.map(async fund => {
      const data = await fetchFundQuote(fund.code, fund.name);
      return { fund, data };
    })
  );

  results.forEach(result => {
    if (result.status !== 'fulfilled') {
      failCount++;
      return;
    }

    const { fund, data } = result.value;
    if (data && data.dwjz) {
      fund.currentNav = toNumber(data.dwjz, fund.currentNav || fund.buyPrice);
      fund.estNav = toNumber(data.gsz, fund.estNav || fund.currentNav || fund.buyPrice);
      fund.estChange = toNumber(data.gszzl, fund.estChange);
      fund.lastUpdate = new Date().toLocaleString('zh-CN');
      fund.navDate = data.jzrq;
      successCount++;
      return;
    }

    failCount++;
  });

  saveFunds(funds);
  renderFundList();
  updateSummary();
  refreshCurrentTabViews();

  if (failCount === 0) {
    showToast(`全部 ${successCount} 只基金估值已更新！`, 'success');
  } else {
    showToast(`更新完成: ${successCount} 成功, ${failCount} 失败`, 'warning');
  }
}

// 刷新单只基金
async function refreshSingleFund(fundId) {
  const funds = getFunds();
  const fund = funds.find(f => f.id === fundId);
  if (!fund) return;

  try {
    const data = await fetchFundQuote(fund.code, fund.name);
    if (data && data.dwjz) {
      fund.currentNav = toNumber(data.dwjz, fund.currentNav || fund.buyPrice);
      fund.estNav = toNumber(data.gsz, fund.estNav || fund.currentNav || fund.buyPrice);
      fund.estChange = toNumber(data.gszzl, fund.estChange);
      fund.lastUpdate = new Date().toLocaleString('zh-CN');
      fund.navDate = data.jzrq;
      saveFunds(funds);
      renderFundList();
      updateSummary();
      refreshCurrentTabViews();
      showToast(`${fund.name} 估值已更新`, 'success');
    }
  } catch (err) {
    showToast('刷新失败: ' + err.message, 'error');
  }
}

// ==================== 渲染持仓列表 ====================

function renderFundList() {
  const funds = getFunds();
  const container = document.getElementById('fundList');

  if (funds.length === 0) {
    container.innerHTML = '';
    container.appendChild(createEmptyState('fas fa-inbox', '暂无持仓基金', '点击"添加基金"开始管理您的投资组合'));
    refreshPredictionFundOptions();
    return;
  }

  container.innerHTML = funds.map(fund => {
    const cost = fund.buyPrice * fund.shares;
    const currentValue = (fund.estNav || fund.currentNav) * fund.shares;
    const profit = currentValue - cost;
    const profitRate = cost > 0 ? (profit / cost * 100) : 0;
    const profitClass = profit > 0 ? 'profit-positive' : (profit < 0 ? 'profit-negative' : 'profit-zero');
    const estChangeClass = fund.estChange >= 0 ? 'profit-positive' : 'profit-negative';

    return `
      <div class="fund-card" data-id="${fund.id}">
        <div class="fund-card-header">
          <div class="fund-name-group">
            <div class="fund-name">${fund.name}</div>
            <span class="fund-code">${fund.code}</span>
          </div>
          <div class="fund-actions">
            <button class="btn-icon edit" onclick="refreshSingleFund('${fund.id}')" title="刷新">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="btn-icon edit" onclick="editFund('${fund.id}')" title="编辑">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn-icon delete" onclick="deleteFund('${fund.id}')" title="删除">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="fund-card-body">
          <div class="fund-stat">
            <span class="fund-stat-label">参考净值</span>
            <span class="fund-stat-value">${(fund.estNav || fund.currentNav || 0).toFixed(4)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">当日涨跌</span>
            <span class="fund-stat-value ${estChangeClass}">${fund.estChange >= 0 ? '+' : ''}${(fund.estChange || 0).toFixed(2)}%</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">持有份额</span>
            <span class="fund-stat-value">${fund.shares.toFixed(2)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">买入均价</span>
            <span class="fund-stat-value">${fund.buyPrice.toFixed(4)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">持仓成本</span>
            <span class="fund-stat-value">${cost.toFixed(2)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">参考市值</span>
            <span class="fund-stat-value">${currentValue.toFixed(2)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">持仓盈亏</span>
            <span class="fund-stat-value ${profitClass}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">收益率</span>
            <span class="fund-stat-value ${profitClass}">${profitRate >= 0 ? '+' : ''}${profitRate.toFixed(2)}%</span>
          </div>
        </div>
        <div style="margin-top:10px; font-size:11px; color:#999;">
          最新净值日期: ${fund.navDate || '--'} | 更新时间: ${fund.lastUpdate || '--'}
        </div>
      </div>
    `;
  }).join('');

  refreshPredictionFundOptions();
}

// ==================== 更新汇总信息 ====================

function updateSummary() {
  const funds = getFunds();
  
  let totalAssets = 0;
  let totalCost = 0;

  funds.forEach(fund => {
    const nav = fund.estNav || fund.currentNav || fund.buyPrice;
    totalAssets += nav * fund.shares;
    totalCost += fund.buyPrice * fund.shares;
  });

  const totalProfit = totalAssets - totalCost;
  const totalRate = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;

  document.getElementById('totalAssets').textContent = totalAssets.toFixed(2);
  document.getElementById('totalCost').textContent = totalCost.toFixed(2);
  
  const profitEl = document.getElementById('totalProfit');
  profitEl.textContent = (totalProfit >= 0 ? '+' : '') + totalProfit.toFixed(2);
  profitEl.className = 'card-value ' + (totalProfit >= 0 ? 'profit-positive' : 'profit-negative');
  
  const rateEl = document.getElementById('totalRate');
  rateEl.textContent = (totalRate >= 0 ? '+' : '') + totalRate.toFixed(2) + '%';
  rateEl.className = 'card-value ' + (totalRate >= 0 ? 'profit-positive' : 'profit-negative');
}

// ==================== 编辑基金 ====================

function editFund(fundId) {
  const funds = getFunds();
  const fund = funds.find(f => f.id === fundId);
  if (!fund) return;

  // 创建模态框
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3><i class="fas fa-edit"></i> 编辑 ${fund.name}</h3>
      <div class="form-group">
        <label>买入均价(元)</label>
        <input type="number" id="editBuyPrice" step="0.0001" value="${fund.buyPrice}">
      </div>
      <div class="form-group">
        <label>持有份额</label>
        <input type="number" id="editShares" step="0.01" value="${fund.shares}">
      </div>
      <div class="form-group">
        <label>买入日期</label>
        <input type="date" id="editBuyDate" value="${fund.buyDate}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="saveEdit('${fundId}')">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  
  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}

function saveEdit(fundId) {
  const buyPrice = parseFloat(document.getElementById('editBuyPrice').value);
  const shares = parseFloat(document.getElementById('editShares').value);
  const buyDate = document.getElementById('editBuyDate').value;

  if (!buyPrice || buyPrice <= 0 || !shares || shares <= 0) {
    showToast('请输入有效数值', 'warning');
    return;
  }

  const funds = getFunds();
  const fund = funds.find(f => f.id === fundId);
  if (fund) {
    fund.buyPrice = buyPrice;
    fund.shares = shares;
    fund.buyDate = buyDate;
    saveFunds(funds);
    renderFundList();
    updateSummary();
    recordDailySnapshot(true);
    showToast('修改已保存', 'success');
  }
  closeModal();
}

function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
}

// ==================== 删除基金 ====================

function deleteFund(fundId) {
  const funds = getFunds();
  const fund = funds.find(f => f.id === fundId);
  if (!fund) return;

  if (!confirm(`确定要删除 "${fund.name}" 吗？`)) return;

  const newFunds = funds.filter(f => f.id !== fundId);
  saveFunds(newFunds);
  renderFundList();
  updateSummary();
  recordDailySnapshot(true);
  showToast(`${fund.name} 已删除`, 'success');
}

// ==================== 记录每日盈亏快照 ====================

function recordDailySnapshot(silent = false) {
  const funds = getFunds();
  if (funds.length === 0) {
    if (!silent) showToast('暂无持仓基金，无法记录', 'warning');
    return;
  }

  const today = getLocalDateString();
  const snapshots = getSnapshots();

  // 检查今天是否已记录
  const existingIndex = snapshots.findIndex(s => s.date === today);

  let totalAssets = 0;
  let totalCost = 0;
  const fundDetails = [];

  funds.forEach(fund => {
    const nav = fund.estNav || fund.currentNav || fund.buyPrice;
    const value = nav * fund.shares;
    const cost = fund.buyPrice * fund.shares;
    const profit = value - cost;

    totalAssets += value;
    totalCost += cost;

    fundDetails.push({
      code: fund.code,
      name: fund.name,
      nav: parseFloat(nav.toFixed(4)),
      shares: fund.shares,
      value: parseFloat(value.toFixed(2)),
      cost: parseFloat(cost.toFixed(2)),
      profit: parseFloat(profit.toFixed(2))
    });
  });

  const snapshot = {
    date: today,
    timestamp: new Date().toLocaleString('zh-CN'),
    totalAssets: parseFloat(totalAssets.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    totalProfit: parseFloat((totalAssets - totalCost).toFixed(2)),
    totalRate: totalCost > 0 ? parseFloat(((totalAssets - totalCost) / totalCost * 100).toFixed(2)) : 0,
    funds: fundDetails
  };

  if (existingIndex >= 0) {
    snapshots[existingIndex] = snapshot;
    if (!silent) showToast('今日盈亏记录已更新！', 'success');
  } else {
    snapshots.push(snapshot);
    if (!silent) showToast('今日盈亏已记录！', 'success');
  }

  // 按日期排序
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  saveSnapshots(snapshots);
  refreshCurrentTabViews();
}

// ==================== 基金预测 ====================

function refreshPredictionFundOptions() {
  const selectEl = document.getElementById('predictionFund');
  const funds = getFunds();
  if (!selectEl) return;

  if (funds.length === 0) {
    selectEl.innerHTML = '<option value="">暂无持仓基金</option>';
    selectEl.disabled = true;
    clearPredictionView();
    return;
  }

  const previousValue = selectEl.value;
  selectEl.disabled = false;
  selectEl.innerHTML = funds.map(fund => (
    `<option value="${fund.code}">${fund.name} (${fund.code})</option>`
  )).join('');

  const hasPrevious = funds.some(fund => fund.code === previousValue);
  selectEl.value = hasPrevious ? previousValue : funds[0].code;
}

function clearPredictionView() {
  const chartEl = document.getElementById('predictionChart');
  const emptyEl = document.getElementById('predictionEmpty');
  const summaryEl = document.getElementById('predictionSummary');

  if (chartEl && window.Plotly) {
    Plotly.purge(chartEl);
  }
  if (chartEl) chartEl.style.display = 'none';
  if (summaryEl) {
    summaryEl.style.display = 'none';
    summaryEl.innerHTML = '';
  }
  if (emptyEl) emptyEl.style.display = 'block';
}

function getHistorySeries(historyResponse) {
  const list = historyResponse?.Data?.LSJZList || historyResponse?.LSJZList || [];
  return list
    .map(item => ({
      date: item.FSRQ || item.JZRQ || item.JzDate,
      nav: toNumber(item.DWJZ ?? item.Nav)
    }))
    .filter(item => item.date && item.nav > 0)
    .reverse();
}

function calculateMovingAverage(values, period) {
  const window = values.slice(-period);
  if (window.length === 0) return 0;
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function calculateDailyReturns(values) {
  const returns = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }
  return returns;
}

function calculateVolatility(values) {
  const returns = calculateDailyReturns(values);
  if (returns.length === 0) return 0;

  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

function linearRegressionForecast(values, futureDays) {
  if (values.length < 2) {
    return Array.from({ length: futureDays }, () => values.at(-1) || 0);
  }

  const points = values.map((value, index) => ({ x: index, y: value }));
  const count = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);

  const denominator = count * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;

  return Array.from({ length: futureDays }, (_, index) => {
    const predicted = intercept + slope * (values.length + index);
    return Math.max(predicted, 0);
  });
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

function buildPredictionModel(series) {
  const values = series.map(item => item.nav);
  const recentValues = values.slice(-20);
  const latestNav = recentValues.at(-1) || 0;
  const ma5 = calculateMovingAverage(recentValues, Math.min(5, recentValues.length));
  const ma10 = calculateMovingAverage(recentValues, Math.min(10, recentValues.length));
  const momentumBase = recentValues.length > 5 ? recentValues.at(-6) : recentValues[0];
  const momentum = momentumBase > 0 ? ((latestNav - momentumBase) / momentumBase) * 100 : 0;
  const volatility = calculateVolatility(recentValues);
  const forecastValues = linearRegressionForecast(recentValues, 5);
  const predictedNav = forecastValues.at(-1) || latestNav;
  const confidence = Math.max(25, Math.min(88, 90 - volatility * 6));

  let trendLabel = '震荡';
  if (ma5 > ma10 && momentum > 0) {
    trendLabel = '偏强';
  } else if (ma5 < ma10 && momentum < 0) {
    trendLabel = '偏弱';
  }

  return {
    latestNav,
    ma5,
    ma10,
    momentum,
    volatility,
    predictedNav,
    confidence,
    trendLabel,
    forecastValues
  };
}

function renderPredictionSummary(fund, model) {
  const summaryEl = document.getElementById('predictionSummary');
  const trendClass = model.momentum >= 0 ? 'profit-positive' : 'profit-negative';
  const delta = model.latestNav > 0 ? ((model.predictedNav - model.latestNav) / model.latestNav * 100) : 0;
  const deltaClass = delta >= 0 ? 'profit-positive' : 'profit-negative';

  summaryEl.innerHTML = `
    <div class="prediction-card">
      <span class="prediction-card-label">预测基金</span>
      <span class="prediction-card-value">${fund.name}</span>
      <div class="prediction-note">${fund.code}</div>
    </div>
    <div class="prediction-card">
      <span class="prediction-card-label">趋势判断</span>
      <span class="prediction-card-value ${trendClass}">${model.trendLabel}</span>
      <div class="prediction-note">结合 5 日/10 日均线与动量</div>
    </div>
    <div class="prediction-card">
      <span class="prediction-card-label">5 个交易日参考净值</span>
      <span class="prediction-card-value ${deltaClass}">${model.predictedNav.toFixed(4)}</span>
      <div class="prediction-note">${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%</div>
    </div>
    <div class="prediction-card">
      <span class="prediction-card-label">波动率 / 置信参考</span>
      <span class="prediction-card-value">${model.volatility.toFixed(2)}%</span>
      <div class="prediction-note">参考置信度 ${model.confidence.toFixed(0)}%</div>
    </div>
  `;
  summaryEl.style.display = 'grid';
}

function renderPredictionChart(fund, series, model) {
  const chartEl = document.getElementById('predictionChart');
  const emptyEl = document.getElementById('predictionEmpty');
  const historicalDates = series.map(item => item.date);
  const historicalValues = series.map(item => item.nav);
  const lastDate = historicalDates.at(-1);
  const futureDates = model.forecastValues.map((_, index) => addDays(lastDate, index + 1));

  emptyEl.style.display = 'none';
  chartEl.style.display = 'block';

  const traces = [
    {
      x: historicalDates,
      y: historicalValues,
      type: 'scatter',
      mode: 'lines+markers',
      name: '历史净值',
      line: { color: '#1a73e8', width: 3 },
      marker: { size: 5 }
    },
    {
      x: [lastDate, ...futureDates],
      y: [historicalValues.at(-1), ...model.forecastValues],
      type: 'scatter',
      mode: 'lines+markers',
      name: '预测区间',
      line: { color: '#f57c00', width: 3, dash: 'dash' },
      marker: { size: 5 }
    }
  ];

  const layout = {
    title: { text: `${fund.name} 短期净值预测`, font: { size: 16 } },
    xaxis: { title: '日期', tickangle: -45, gridcolor: '#f0f0f0' },
    yaxis: { title: '净值(元)', gridcolor: '#f0f0f0' },
    legend: { orientation: 'h', y: -0.2 },
    margin: { t: 50, b: 80, l: 60, r: 30 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
    hovermode: 'x unified'
  };

  Plotly.newPlot(chartEl, traces, layout, {
    responsive: true,
    displayModeBar: false
  });
}

async function generatePrediction() {
  const funds = getFunds();
  if (funds.length === 0) {
    clearPredictionView();
    showToast('请先添加基金持仓', 'warning');
    return;
  }

  const selectEl = document.getElementById('predictionFund');
  const fund = funds.find(item => item.code === selectEl.value) || funds[0];
  if (!fund) {
    showToast('未找到可预测的基金', 'warning');
    return;
  }

  showToast(`正在分析 ${fund.name} 的历史净值...`, '');

  try {
    const historyResponse = await fetchFundHistory(fund.code, 40);
    const series = getHistorySeries(historyResponse);
    if (series.length < 8) {
      clearPredictionView();
      showToast('历史净值数据不足，暂时无法预测', 'warning');
      return;
    }

    const model = buildPredictionModel(series);
    renderPredictionSummary(fund, model);
    renderPredictionChart(fund, series, model);
    showToast(`${fund.name} 预测分析已生成`, 'success');
  } catch (err) {
    clearPredictionView();
    showToast('预测失败: ' + err.message, 'error');
  }
}

// ==================== 收益曲线 ====================

function updateYieldChart(days, btnEl) {
  // 更新按钮状态
  if (btnEl) {
    document.querySelectorAll('.chart-controls .btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }

  const snapshots = getSnapshots();
  const chartEl = document.getElementById('yieldChart');
  const emptyEl = document.getElementById('yieldChartEmpty');

  if (snapshots.length === 0) {
    chartEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  chartEl.style.display = 'block';
  emptyEl.style.display = 'none';

  let filteredSnapshots = snapshots;
  if (days > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    filteredSnapshots = snapshots.filter(s => s.date >= cutoffStr);
  }

  if (filteredSnapshots.length === 0) {
    filteredSnapshots = snapshots;
  }

  const dates = filteredSnapshots.map(s => s.date);
  const profits = filteredSnapshots.map(s => s.totalProfit);
  const rates = filteredSnapshots.map(s => s.totalRate);
  const assets = filteredSnapshots.map(s => s.totalAssets);

  // 收益金额曲线
  const traceProfits = {
    x: dates,
    y: profits,
    type: 'scatter',
    mode: 'lines+markers',
    name: '累计盈亏(元)',
    line: { color: '#1a73e8', width: 3 },
    marker: { size: 6 },
    fill: 'tozeroy',
    fillcolor: 'rgba(26, 115, 232, 0.1)'
  };

  // 收益率曲线
  const traceRates = {
    x: dates,
    y: rates,
    type: 'scatter',
    mode: 'lines+markers',
    name: '收益率(%)',
    line: { color: '#0d9e6c', width: 2, dash: 'dot' },
    marker: { size: 5 },
    yaxis: 'y2'
  };

  const layout = {
    title: { text: '投资组合收益走势', font: { size: 16 } },
    xaxis: { 
      title: '日期',
      tickangle: -45,
      gridcolor: '#f0f0f0'
    },
    yaxis: { 
      title: '盈亏金额(元)',
      gridcolor: '#f0f0f0',
      zeroline: true,
      zerolinecolor: '#ccc'
    },
    yaxis2: {
      title: '收益率(%)',
      overlaying: 'y',
      side: 'right',
      gridcolor: '#f0f0f0'
    },
    legend: {
      orientation: 'h',
      y: -0.2
    },
    margin: { t: 50, b: 80, l: 60, r: 60 },
    plot_bgcolor: 'white',
    paper_bgcolor: 'white',
    hovermode: 'x unified'
  };

  const config = {
    responsive: true,
    displayModeBar: false
  };

  Plotly.newPlot(chartEl, [traceProfits, traceRates], layout, config);
}

// 持仓分布饼图
function updateAllocationChart() {
  const funds = getFunds();
  const chartEl = document.getElementById('allocationChart');
  const emptyEl = document.getElementById('allocationChartEmpty');

  if (funds.length === 0) {
    chartEl.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }

  chartEl.style.display = 'block';
  emptyEl.style.display = 'none';

  const labels = funds.map(f => f.name);
  const values = funds.map(f => {
    const nav = f.estNav || f.currentNav || f.buyPrice;
    return parseFloat((nav * f.shares).toFixed(2));
  });

  const colors = [
    '#1a73e8', '#0d9e6c', '#e53935', '#f9a825', '#764ba2',
    '#00bcd4', '#ff7043', '#8bc34a', '#9c27b0', '#607d8b'
  ];

  const trace = {
    labels: labels,
    values: values,
    type: 'pie',
    hole: 0.4,
    marker: {
      colors: colors.slice(0, funds.length)
    },
    textinfo: 'label+percent',
    textposition: 'outside',
    hovertemplate: '%{label}<br>市值: %{value:.2f}元<br>占比: %{percent}<extra></extra>'
  };

  const layout = {
    title: { text: '持仓市值分布', font: { size: 16 } },
    showlegend: true,
    legend: {
      orientation: 'h',
      y: -0.1
    },
    margin: { t: 50, b: 50, l: 20, r: 20 },
    paper_bgcolor: 'white'
  };

  const config = {
    responsive: true,
    displayModeBar: false
  };

  Plotly.newPlot(chartEl, [trace], layout, config);
}

// ==================== 盈亏记录历史 ====================

function renderHistory() {
  const snapshots = getSnapshots();
  const container = document.getElementById('historyTable');
  const emptyEl = document.getElementById('historyEmpty');

  if (snapshots.length === 0) {
    container.innerHTML = '';
    container.appendChild(createEmptyState('fas fa-clipboard-list', '暂无盈亏记录', '在持仓页面点击"记录今日盈亏"来保存每日数据'));
    return;
  }

  // 按日期倒序
  const sorted = [...snapshots].reverse();

  let html = `
    <table class="history-table">
      <thead>
        <tr>
          <th>日期</th>
          <th>总资产(元)</th>
          <th>总成本(元)</th>
          <th>总盈亏(元)</th>
          <th>当日变化(元)</th>
          <th>收益率</th>
          <th>持仓数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  sorted.forEach((snap, index) => {
    const profitClass = snap.totalProfit >= 0 ? 'profit-positive' : 'profit-negative';
    
    // 计算日收益（与前一天对比）
    let dailyProfit = '--';
    const prevIndex = snapshots.findIndex(item => item.date === snap.date) - 1;
    if (prevIndex >= 0) {
      const diff = snap.totalProfit - snapshots[prevIndex].totalProfit;
      dailyProfit = `<span class="${diff >= 0 ? 'profit-positive' : 'profit-negative'}">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}</span>`;
    }

    html += `
      <tr>
        <td><strong>${snap.date}</strong></td>
        <td>${snap.totalAssets.toFixed(2)}</td>
        <td>${snap.totalCost.toFixed(2)}</td>
        <td class="${profitClass}"><strong>${snap.totalProfit >= 0 ? '+' : ''}${snap.totalProfit.toFixed(2)}</strong></td>
        <td>${dailyProfit}</td>
        <td class="${profitClass}">${snap.totalRate >= 0 ? '+' : ''}${snap.totalRate.toFixed(2)}%</td>
        <td>${snap.funds ? snap.funds.length : '--'}</td>
        <td>
          <button class="btn-icon delete" onclick="deleteSnapshot('${snap.date}')" title="删除">
            <i class="fas fa-times"></i>
          </button>
        </td>
      </tr>
    `;
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

function deleteSnapshot(date) {
  if (!confirm(`确定删除 ${date} 的记录吗？`)) return;
  
  let snapshots = getSnapshots();
  snapshots = snapshots.filter(s => s.date !== date);
  saveSnapshots(snapshots);
  renderHistory();
  refreshCurrentTabViews();
  showToast('记录已删除', 'success');
}

function clearHistory() {
  if (!confirm('确定要清空所有盈亏记录吗？此操作不可恢复！')) return;
  
  saveSnapshots([]);
  renderHistory();
  refreshCurrentTabViews();
  showToast('所有记录已清空', 'success');
}

// ==================== 工具函数 ====================

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

function createEmptyState(icon, title, desc) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <i class="${icon}"></i>
    <p>${title}</p>
    <p>${desc}</p>
  `;
  return div;
}

// ==================== 键盘快捷键 ====================

document.addEventListener('keydown', (e) => {
  // Enter键在基金代码输入框中触发查询
  if (e.key === 'Enter' && document.activeElement.id === 'fundCode') {
    searchFund();
  }
});
