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
  renderHistory();
});

// ==================== 基金查询 (天天基金API) ====================

// 临时存储查询到的基金信息
let currentSearchResult = null;

// 通过JSONP方式获取基金实时估值数据
function fetchFundEstimate(code) {
  return new Promise((resolve, reject) => {
    const callbackName = `fundCallback_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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
    
    // 天天基金估值接口
    script.src = `https://fundgz.1702.com/js/${code}.js?rt=${Date.now()}&callback=${callbackName}`;
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

// 获取基金历史净值 (通过天天基金JSONP)
function fetchFundHistory(code, pageSize = 30) {
  return new Promise((resolve, reject) => {
    const callbackName = `histCallback_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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
    
    script.src = `https://api.fund.eastmoney.com/f10/lsjz?callback=${callbackName}&fundCode=${code}&pageIndex=1&pageSize=${pageSize}&startDate=&endDate=&_=${Date.now()}`;
    document.head.appendChild(script);
    
    setTimeout(() => {
      if (window[callbackName]) {
        reject(new Error('请求超时'));
        delete window[callbackName];
        if (script.parentNode) document.head.removeChild(script);
      }
    }, 10000);
  });
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
    const data = await fetchFundEstimate(code);
    
    if (!data || !data.name) {
      showToast('未找到该基金，请检查代码', 'error');
      return;
    }

    currentSearchResult = data;
    
    // 显示查询结果
    document.getElementById('fundSearchResult').style.display = 'block';
    document.getElementById('previewFundName').textContent = data.name;
    document.getElementById('previewFundCode').textContent = data.fundcode;
    document.getElementById('previewNav').textContent = data.dwjz + ' 元 (' + data.jzrq + ')';
    document.getElementById('previewEstNav').textContent = data.gsz + ' 元';
    
    const changeVal = parseFloat(data.gszzl);
    const changeEl = document.getElementById('previewEstChange');
    changeEl.textContent = (changeVal >= 0 ? '+' : '') + data.gszzl + '%';
    changeEl.className = changeVal >= 0 ? 'profit-positive' : 'profit-negative';
    
    // 自动填入最新净值作为买入价参考
    document.getElementById('buyPrice').value = data.dwjz;
    
    showToast('查询成功！', 'success');
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
      const data = await fetchFundEstimate(fund.code);
      return { fund, data };
    })
  );

  results.forEach(result => {
    if (result.status !== 'fulfilled') {
      failCount++;
      return;
    }

    const { fund, data } = result.value;
    if (data && data.gsz) {
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
    const data = await fetchFundEstimate(fund.code);
    if (data && data.gsz) {
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
  const emptyState = document.getElementById('emptyState');

  if (funds.length === 0) {
    container.innerHTML = '';
    container.appendChild(createEmptyState('fas fa-inbox', '暂无持仓基金', '点击"添加基金"开始管理您的投资组合'));
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
            <span class="fund-stat-label">估算净值</span>
            <span class="fund-stat-value">${(fund.estNav || fund.currentNav || 0).toFixed(4)}</span>
          </div>
          <div class="fund-stat">
            <span class="fund-stat-label">估算涨跌</span>
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
            <span class="fund-stat-label">估算市值</span>
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
