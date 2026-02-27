// 用于初始化 Pyodide 和加载 Python
let pyodideReadyPromise = loadPyodide();

// 模拟基金实时 API 拉取数据
async function fetchFund(code) {
  // 假设 API 返回的数据结构
  const fundData = {
    price: Math.random() * 100 + 10, // 模拟价格
    change: Math.random() * 5 - 2,   // 模拟涨跌幅（-2 到 3）
    history: [
      [1, 50, 1.5], [2, 51, 1.6], [3, 50.5, 1.7], [4, 52, 1.8], [5, 53, 1.9]
    ] // 模拟历史数据 (时间，价格，涨幅)
  };

  let pyCode = `
price = ${fundData.price}
change = ${fundData.change}
history = ${JSON.stringify(fundData.history)}

output = f"基金价格: {price}, 涨跌幅: {change}%"
output
`;

  let pyodide = await pyodideReadyPromise;
  let result = await pyodide.runPythonAsync(pyCode);
  document.getElementById("output").innerText = result;

  // 绘制历史数据
  drawChart(fundData.history);
}

// 绘制历史价格变化图表
function drawChart(data) {
  const chartContainer = document.getElementById('chart-container');
  chartContainer.innerHTML = '';  // 清空图表容器

  let dates = data.map(item => item[0]);
  let prices = data.map(item => item[1]);

  let trace = {
    x: dates,
    y: prices,
    type: 'scatter',
    mode: 'lines+markers',
    name: '基金价格',
    line: {color: 'blue'}
  };

  let layout = {
    title: '基金历史价格变化',
    xaxis: {title: '日期'},
    yaxis: {title: '价格 (元)'}
  };

  Plotly.newPlot(chartContainer, [trace], layout);
}

// 初始化页面时自动刷新数据
window.onload = function() {
  let code = document.getElementById('fundCode').value;
  fetchFund(code);

  // 设置每10秒刷新一次
  setInterval(() => {
    fetchFund(code);
  }, 10000);
};