// 画布工作流引擎核心
(function() {
  'use strict';

  // ── 并发控制 & 停止机制 ──────────────────────────────────────
  const _runningWorkflows = new Set();
  const _activeControllers = new Map();  // nodeId → AbortController

  // ── 规范化 canvas 数据 ────────────────────────────────────
  // 支持 { canvases: {[id]: {components, connections}}, activeCanvasId }
  // 和 { components, connections } 两种格式
  function normalizeCanvas(canvas) {
    if (canvas.canvases && canvas.activeCanvasId) {
      const tab = canvas.canvases[canvas.activeCanvasId];
      return tab ? { components: tab.components || [], connections: tab.connections || [] } : null;
    }
    return { components: canvas.components || [], connections: canvas.connections || [] };
  }

  // ── 图构建 ─────────────────────────────────────────────────
  // 从 canvas.components 和 canvas.connections 构建邻接表（含逆向索引）
  // 返回 { graph: Map<fromId, toIds[]>, reverse: Map<toId, fromIds[]>, nodes: Set<id> }
  function buildGraph(canvas) {
    const norm = normalizeCanvas(canvas);
    if (!norm) return { graph: new Map(), reverse: new Map(), nodes: new Set() };
    const { components, connections } = norm;
    const graph = new Map();    // 正向：从 A 出发的所有出边目标
    const reverse = new Map();  // 逆向：指向 A 的所有入边来源

    // 初始化所有节点
    const nodes = new Set();
    for (const comp of components) {
      nodes.add(comp.id);
      graph.set(comp.id, []);
      reverse.set(comp.id, []);
    }

    // 构建邻接表
    for (const conn of connections) {
      if (nodes.has(conn.from) && nodes.has(conn.to)) {
        graph.get(conn.from).push(conn.to);
        reverse.get(conn.to).push(conn.from);
      }
    }

    return { graph, reverse, nodes };
  }

  // ── 拓扑排序 (Kahn 算法) ───────────────────────────────────
  function topologicalSort(graph, nodes) {
    const inDegree = new Map();
    const allNodes = nodes || graph.keys();

    // 初始化入度
    for (const node of allNodes) {
      inDegree.set(node, 0);
    }

    // 计算所有节点的入度
    for (const [, toNodes] of graph) {
      for (const to of toNodes) {
        inDegree.set(to, (inDegree.get(to) || 0) + 1);
      }
    }

    // 入度为 0 的节点队列
    const queue = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) queue.push(node);
    }

    const sorted = [];
    while (queue.length > 0) {
      const node = queue.shift();
      sorted.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        const newDegree = inDegree.get(neighbor) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return sorted;
  }

  // ── 环路检测 ──────────────────────────────────────────────
  function hasCycle(sorted, graph, nodes) {
    return sorted.length < (nodes ? nodes.size : graph.size);
  }

  // ── 连通子图 (BFS，双向遍历捕获完整上游链) ────────────────
  function getConnectedSubgraph(canvas, startId) {
    const { graph, reverse, nodes } = buildGraph(canvas);
    if (!nodes.has(startId)) return { nodes: new Set(), edges: [], components: new Map() };

    const visited = new Set();
    const queue = [startId];
    visited.add(startId);

    const subgraphNodes = new Set([startId]);

    // 双向 BFS：同时向前（下游）和向后（上游）遍历
    while (queue.length > 0) {
      const current = queue.shift();
      // 前向邻居
      for (const neighbor of (graph.get(current) || [])) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); subgraphNodes.add(neighbor); }
      }
      // 反向邻居（上游）
      for (const neighbor of (reverse.get(current) || [])) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); subgraphNodes.add(neighbor); }
      }
    }

    // 收集子图内的边
    const subgraphEdges = [];
    const norm = normalizeCanvas(canvas);
    if (!norm) return { nodes: new Set(), edges: [], components: new Map() };
    for (const conn of norm.connections) {
      if (subgraphNodes.has(conn.from) && subgraphNodes.has(conn.to)) {
        subgraphEdges.push(conn);
      }
    }

    // 收集子图内的组件
    const subgraphComponents = new Map();
    for (const comp of norm.components) {
      if (subgraphNodes.has(comp.id)) {
        subgraphComponents.set(comp.id, comp);
      }
    }

    return { nodes: subgraphNodes, edges: subgraphEdges, components: subgraphComponents };
  }

  // ── 所有连通子图 ──────────────────────────────────────────
  function getAllConnectedSubgraphs(canvas) {
    const norm = normalizeCanvas(canvas);
    if (!norm) return [];
    const { nodes } = buildGraph(canvas);
    const visited = new Set();
    const subgraphs = [];

    for (const nodeId of nodes) {
      if (visited.has(nodeId)) continue;

      // BFS 找连通分量
      const componentNodes = new Set();
      const queue = [nodeId];
      visited.add(nodeId);

      while (queue.length > 0) {
        const current = queue.shift();
        componentNodes.add(current);

        for (const conn of norm.connections) {
          if (conn.from === current && !visited.has(conn.to)) {
            visited.add(conn.to);
            queue.push(conn.to);
          }
          if (conn.to === current && !visited.has(conn.from)) {
            visited.add(conn.from);
            queue.push(conn.from);
          }
        }
      }

      // 构建子图
      const subgraphEdges = norm.connections.filter(
        conn => componentNodes.has(conn.from) && componentNodes.has(conn.to)
      );

      subgraphs.push({
        nodes: componentNodes,
        edges: subgraphEdges
      });
    }

    return subgraphs;
  }

  // ── 起点查找 (入度为 0) ────────────────────────────────────
  function findStartNodes(subgraph) {
    const { edges } = subgraph;
    const inDegree = new Map();

    for (const node of subgraph.nodes) {
      inDegree.set(node, 0);
    }

    for (const edge of edges) {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    }

    const startNodes = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) startNodes.push(node);
    }

    return startNodes;
  }

  // ── 表达式解析 ─────────────────────────────────────────────
  // 解析 ${upstream.result}、${upstream.metadata.duration}、
  // ${step-1.result === 'ok'} 等表达式
  function resolveExpr(expr, context) {
    if (typeof expr !== 'string') return expr;

    // 匹配 ${...} 表达式
    const match = expr.match(/^\$\{(.+)\}$/);
    if (!match) return expr;

    const inner = match[1].trim();

    // 处理比较表达式: step-1.result === 'ok', upstream.result !== 'fail'
    const cmpMatch = inner.match(/^(.+?)\s*(===|!==|==|!=|<|>|<=|>=)\s*(.+)$/);
    if (cmpMatch) {
      const [, leftRaw, operator, rightRaw] = cmpMatch;
      const left = resolveValue(leftRaw.trim(), context);
      const right = resolveValue(rightRaw.trim(), context);
      switch (operator) {
        case '===': case '==': return left == right;
        case '!==': case '!=': return left != right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
      }
    }

    // 简单值引用
    return resolveValue(inner, context);
  }

  function resolveValue(path, context) {
    const parts = path.split('.');
    let current = context;

    for (const part of parts) {
      if (current == null) return undefined;
      // 处理数组索引如 upstream[0]
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, key, index] = arrayMatch;
        current = current[key];
        if (Array.isArray(current)) {
          current = current[parseInt(index)];
        }
      } else {
        current = current[part];
      }
    }

    return current;
  }

  // ── 输入映射 ───────────────────────────────────────────────
  function applyInputMapping(comp, upstreamContext) {
    const inputMapping = comp.data?.inputMapping;

    if (inputMapping) {
      // 使用显式映射
      const mapped = {};
      for (const [key, expr] of Object.entries(inputMapping)) {
        mapped[key] = resolveExpr(expr, upstreamContext);
      }
      return mapped;
    }

    // 自动猜测
    const type = comp.type;
    const ctx = upstreamContext?.context || upstreamContext;

    if (type === 'text' || type === 'note') {
      return { content: ctx?.content || upstreamContext?.result || '' };
    }
    if (type === 'image' || type === 'video') {
      return { path: ctx?.path || upstreamContext?.result || '' };
    }

    // 默认透传
    return upstreamContext?.result ?? upstreamContext ?? {};
  }

  // ── 引擎判断 ───────────────────────────────────────────────
  function resolveEngine(comp) {
    const engine = comp.data?.engine;
    if (engine === 'hermes' || engine === 'builtin') return engine;

    // auto 模式按类型判断
    if (engine === 'auto' || !engine) {
      const hermesTypes = ['skill', 'text', 'note', 'image', 'video'];
      if (hermesTypes.includes(comp.type)) return 'hermes';
      return 'builtin';
    }

    return 'builtin';
  }

  // ── 状态更新 ───────────────────────────────────────────────
  function updateComponentStatus(compId, status, progress, result) {
    window.dispatchEvent(new CustomEvent('workflow:componentStatus', {
      detail: { compId, status, progress, result }
    }));
  }

  // ── 内置运行时 ─────────────────────────────────────────────
  async function runBuiltin(comp, input, context) {
    const type = comp.data?.type || comp.type;
    const startTime = Date.now();

    try {
      switch (type) {
        case 'http': {
          const url = resolveExpr(comp.data?.url || '${input.url}', { input, ...context }) || '';
          const method = comp.data?.method || 'GET';
          const headers = comp.data?.headers || {};

          const fetchOptions = { method, headers };
          if (method !== 'GET') {
            fetchOptions.body = JSON.stringify(input);
            fetchOptions.headers['Content-Type'] = 'application/json';
          }

          const resp = await fetch(url, fetchOptions);
          const result = await resp.json().catch(() => resp.text());

          return {
            result,
            metadata: {
              duration: Date.now() - startTime,
              engine: 'builtin',
              type: 'http',
              status: resp.status
            },
            context: { input, ...context }
          };
        }

        case 'wait': {
          const delay = parseInt(comp.data?.delay || '1000');
          await new Promise(resolve => setTimeout(resolve, delay));
          return {
            result: 'waited',
            metadata: {
              duration: Date.now() - startTime,
              engine: 'builtin',
              type: 'wait',
              delay
            },
            context: { input, ...context }
          };
        }

        case 'transform': {
          const expr = comp.data?.expr || '${input}';
          const result = resolveExpr(expr, { input, ...context });
          return {
            result,
            metadata: {
              duration: Date.now() - startTime,
              engine: 'builtin',
              type: 'transform'
            },
            context: { input, ...context }
          };
        }

        case 'condition': {
          const expr = comp.data?.expr;
          const trueResult = resolveExpr(expr, { input, ...context });
          return {
            result: trueResult,
            metadata: {
              duration: Date.now() - startTime,
              engine: 'builtin',
              type: 'condition'
            },
            context: { input, ...context }
          };
        }

        default:
          return {
            result: input,
            metadata: {
              duration: Date.now() - startTime,
              engine: 'builtin',
              type: type
            },
            context: { input, ...context }
          };
      }
    } catch (error) {
      return {
        result: null,
        metadata: {
          duration: Date.now() - startTime,
          engine: 'builtin',
          type: type,
          error: error.message
        },
        context: { input, ...context }
      };
    }
  }

  // ── 执行单个组件 ────────────────────────────────────────────
  async function executeComponent(comp, inputContext, canvasId) {
    const engine = resolveEngine(comp);
    const startTime = Date.now();

    // 检查是否已被停止
    const existingCtrl = _activeControllers.get(comp.id);
    if (existingCtrl && existingCtrl.signal.aborted) {
      throw new Error('workflow stopped');
    }

    if (engine === 'hermes') {
      // 调用 Hermes Agent
      const ctrl = new AbortController();
      _activeControllers.set(comp.id, ctrl);
      let result;
      try {
        result = await window.CanvasAPI.executeWorkflow(comp.id, 'run', canvasId);
      } finally {
        _activeControllers.delete(comp.id);
      }
      return {
        result: result.data || result,
        metadata: {
          duration: Date.now() - startTime,
          engine: 'hermes',
          type: comp.type
        },
        context: inputContext
      };
    } else {
      // 内置运行时
      const input = applyInputMapping(comp, inputContext);
      return await runBuiltin(comp, input, inputContext);
    }
  }

  // ── 停止工作流 ─────────────────────────────────────────────
  // 通知后端终止指定节点的 running workflow
  async function stopWorkflow(nodeId) {
    const ctrl = _activeControllers.get(nodeId);
    if (ctrl) {
      ctrl.abort();
      _activeControllers.delete(nodeId);
    }
    try {
      await window.CanvasAPI.executeWorkflow(nodeId, 'stop');
    } catch (e) {
      // stop API 失败不影响前端状态清理
    }
  }

  // ── 上下文传递 ─────────────────────────────────────────────
  function passContext(conn, upstreamContext) {
    // 直接传递完整上下文
    return upstreamContext;
  }

  // ── 条件过滤 ───────────────────────────────────────────────
  function shouldTraverse(conn, upstreamContext) {
    const condition = conn.condition || conn.data?.condition;
    if (!condition) return true;
    return resolveExpr(condition, upstreamContext);
  }

  // ── 循环处理 ───────────────────────────────────────────────
  async function handleLoop(conn, upstreamContext, executeOne) {
    const loop = conn.loop || conn.data?.loop;
    if (!loop) {
      return await executeOne(conn, upstreamContext);
    }

    const items = resolveExpr(loop.items, upstreamContext);
    if (!Array.isArray(items)) {
      return await executeOne(conn, upstreamContext);
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const itemContext = {
        ...upstreamContext,
        loop: {
          index: i,
          item: items[i],
          items: items
        }
      };
      const result = await executeOne(conn, itemContext);
      results.push(result);

      // 如果循环项配置了 break 条件
      if (loop.breakWhen) {
        const shouldBreak = resolveExpr(loop.breakWhen, result);
        if (shouldBreak) break;
      }
    }

    return results;
  }

  // ── 主执行函数 ─────────────────────────────────────────────
  // canvas: 画布数据，可以是 { id, canvases: {[id]: {components, connections}}, activeCanvasId }
  //         也可以是直接的 { components, connections } 结构
  async function runWorkflow(canvas, targetId) {
    // 保存 canvasId（规范化前）
    const canvasId = canvas.id || canvas.activeCanvasId || null;

    // 规范化 canvas 数据（支持嵌套结构或直接结构）
    if (canvas.canvases && canvas.activeCanvasId) {
      const tab = canvas.canvases[canvas.activeCanvasId];
      if (!tab) return { success: false, error: 'No active canvas' };
      canvas = { components: tab.components || [], connections: tab.connections || [] };
    }
    const workflowKey = targetId || 'full';
    if (_runningWorkflows.has(workflowKey)) {
      return { success: false, error: 'Workflow already running' };
    }
    _runningWorkflows.add(workflowKey);

    try {
    // 获取连通子图
    const subgraph = targetId
      ? getConnectedSubgraph(canvas, targetId)
      : getAllConnectedSubgraphs(canvas)[0];

    if (!subgraph || subgraph.nodes.size === 0) {
      return { success: false, error: 'No valid workflow found' };
    }

    // 检查环路
    const tempGraph = new Map();
    for (const node of subgraph.nodes) {
      tempGraph.set(node, []);
    }
    for (const edge of subgraph.edges) {
      tempGraph.get(edge.from)?.push(edge.to);
    }

    const sorted = topologicalSort(tempGraph, subgraph.nodes);
    if (hasCycle(sorted, tempGraph, subgraph.nodes)) {
      return { success: false, error: 'Cycle detected in workflow' };
    }

    // 构建子图组件映射
    const compMap = new Map();
    for (const comp of canvas.components) {
      if (subgraph.nodes.has(comp.id)) {
        compMap.set(comp.id, comp);
      }
    }

    // 找起点
    const startNodes = findStartNodes(subgraph);
    if (startNodes.length === 0) {
      return { success: false, error: 'No start nodes found' };
    }

    // 按拓扑序执行
    const results = [];
    const contextMap = new Map();

    for (const nodeId of sorted) {
      const comp = compMap.get(nodeId);
      if (!comp) continue;

      // 检查是否有上游
      const incomingEdges = subgraph.edges.filter(e => e.to === nodeId);
      const hasUpstream = incomingEdges.length > 0;

      // triggerMode === 'manual' 且有上游，跳过执行
      if (comp.data?.triggerMode === 'manual' && hasUpstream) {
        updateComponentStatus(nodeId, 'queued', 0, null);
        continue;
      }

      // 收集上游上下文
      let upstreamContext = {};
      if (hasUpstream) {
        for (const edge of incomingEdges) {
          if (shouldTraverse(edge, contextMap.get(edge.from))) {
            upstreamContext = passContext(edge, contextMap.get(edge.from));
          }
        }
      }

      // 更新状态为 running
      updateComponentStatus(nodeId, 'running', 0, null);

      try {
        // 执行循环/条件处理
        const result = await handleLoop(
          { from: incomingEdges[0]?.from, to: nodeId },
          upstreamContext,
          async (conn, ctx) => await executeComponent(comp, ctx, canvasId)
        );

        contextMap.set(nodeId, result);
        updateComponentStatus(nodeId, 'completed', 100, result);

        results.push({
          compId: nodeId,
          nodeId,
          result: result.result,
          metadata: result.metadata,
          context: result.context
        });

        // 向下游传递上下文
        const outgoingEdges = subgraph.edges.filter(e => e.from === nodeId);
        for (const edge of outgoingEdges) {
          if (shouldTraverse(edge, result)) {
            contextMap.set(edge.to, result);
          }
        }
      } catch (error) {
        updateComponentStatus(nodeId, 'failed', 0, { error: error.message });
        results.push({
          compId: nodeId,
          nodeId,
          result: null,
          metadata: { engine: 'unknown', type: comp.type, duration: Date.now() - startTime, error: error.message }
        });
      }
    }

    return {
      success: true,
      results
    };
    } finally {
      _runningWorkflows.delete(workflowKey);
    }
  }

  // ── 暴露全局 API ───────────────────────────────────────────
  window.CanvasWorkflow = {
    buildGraph,
    topologicalSort,
    hasCycle,
    getConnectedSubgraph,
    getAllConnectedSubgraphs,
    findStartNodes,
    resolveExpr,
    applyInputMapping,
    resolveEngine,
    updateComponentStatus,
    runBuiltin,
    executeComponent,
    passContext,
    shouldTraverse,
    handleLoop,
    runWorkflow,
    stopWorkflow
  };

})();
