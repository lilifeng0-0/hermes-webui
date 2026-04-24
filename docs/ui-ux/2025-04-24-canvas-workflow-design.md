# 画布工作流处理能力 — 设计规格说明

## 概述

在 Hermes WebUI 画布中增加工作流处理能力，允许用户通过连接线将多个组件串联成工作流，实现自动化任务执行。

**核心设计原则：连接线即工作流。** 不新增节点类型，任何有连接线的组件自动成为工作流的一部分，删除连接线即解除关系。

---

## 一、数据模型

### 1.1 组件扩展字段

现有 6 种组件类型（text、note、image、video、skill、rect）均支持工作流，在 `comp.data` 中新增：

```typescript
interface ComponentData {
  // 新增字段
  triggerMode?: 'manual' | 'auto';   // 触发模式，默认 'manual'
  engine?: 'auto' | 'hermes' | 'builtin'; // 执行引擎，默认 'auto'
  inputMapping?: string;             // 输入映射表达式，如 "${upstream.result}"
  outputField?: string;               // 取值字段，如 "content"、"path"，默认自动猜测
  lastRunResult?: RunResult;          // 上次执行结果
  status?: ComponentStatus;          // 当前状态
  progress?: number;                 // 进度 0~100
}

type ComponentStatus = 'idle' | 'queued' | 'running' | 'success' | 'failed';

interface RunResult {
  result: any;                       // 执行结果
  metadata: {
    duration: number;                // 耗时（秒）
    cost?: number;                   // 成本
    engine: 'hermes' | 'builtin';
    type: string;                    // 操作类型
    error?: string;                  // 错误信息
  };
  context: any;                      // 完整上下文（含 history）
}
```

### 1.2 连接线扩展字段

```typescript
interface ConnectionData {
  // 新增字段
  condition?: string;                // 条件表达式，如 "${step-1.result === 'success'}"
  loop?: {
    variable: string;                // 循环变量名，如 "item"
    source: string;                  // 迭代来源表达式，如 "${step-1.result.items}"
  };
  edgeStyle?: 'solid' | 'dashed-loop';
}
```

### 1.3 工作流识别

**连通子图识别：** 画布上任意由连接线连通的所有组件构成一个工作流。`入度=0` 的节点是该工作流起点，`出度=0` 的节点是终点。

---

## 二、执行引擎

### 2.1 混合引擎架构

```
触发执行
    ↓
┌─────────────────────────────────┐
│  引擎决策                        │
│  engine === 'hermes' → Hermes   │
│  engine === 'builtin' → 内置     │
│  engine === 'auto' → 按类型判断  │
└─────────────────────────────────┘
    ↓
┌──────────────────────────────┐
│ 内置运行时（builtin）           │
│  • http      HTTP 请求         │
│  • transform JSON/字符串变换   │
│  • wait      延时等待          │
│  • condition 条件判断           │
│  • loop      循环迭代         │
└──────────────────────────────┘
    ↓
┌──────────────────────────────┐
│ Hermes Agent                 │
│  • type === 'skill' → 调用 Skill│
│  • type === 'agent' → Agent 推理│
│  • 其他 → 通用 LLM 处理        │
└──────────────────────────────┘
```

### 2.2 自动判断引擎（engine='auto'）

| 组件类型 | 默认引擎 |
|----------|----------|
| skill    | Hermes Agent（直接调用该 Skill）|
| text     | Hermes Agent |
| note     | Hermes Agent |
| image    | Hermes Agent（图片理解）|
| video    | Hermes Agent（视频理解）|
| rect     | 内置运行时（容器，无默认操作）|

用户可手动覆盖为 `hermes` 或 `builtin`。

### 2.3 执行上下文传递

每个组件执行后产生 `RunResult` 对象（含 `result`、`metadata`、`context`），通过连接线传递给下游。下游取值方式：

- `${upstream.result}` — 取执行结果
- `${upstream.metadata.duration}` — 取元数据
- `${upstream.context.history}` — 取完整历史

---

## 三、执行流程

### 3.1 触发入口

1. 用户点击画布上的任意组件
2. 系统检测画布上所有连通子图数量：
   - 如果只有 1 个工作流 → 直接执行该工作流
   - 如果有多个工作流 → 弹窗让用户选择执行哪个（展示工作流包含的组件列表）
3. 从起点沿拓扑顺序自动执行上游所有依赖

### 3.2 拓扑排序执行

```
1. 对目标组件所在的连通子图做拓扑排序
2. 按排序顺序依次执行每个组件
3. 执行前检查 triggerMode：
   - 'auto' 组件：上游执行完成后自动触发
   - 'manual' 组件：必须等待用户点击才执行
4. 每个组件执行完，更新 status 和 progress
5. 如果某组件执行失败：
   - 如果有其他分支路径，尝试走其他分支
   - 如果是唯一路径，终止工作流，更新所有下游组件状态为 'failed'
```

### 3.3 数据传递

1. 上游组件执行完成后，将 `RunResult` 暂存
2. 传给下游前，查找映射：
   - 如果下游有 `inputMapping` → 按表达式填充
   - 否则 → 自动猜测目标字段（text→content、image→path、video→path、note→content）
   - 猜测失败 → 弹窗提示用户配置 `inputMapping`
3. 传递后，下游组件接收到的 `input` 即为填充后的数据

### 3.4 条件分支处理

遇到有 `condition` 属性的边时：
1. 对条件表达式求值（支持 `${upstream.result}` 变量）
2. 条件为 true → 沿该边继续执行
3. 条件为 false → 跳过该分支，继续寻找其他可行路径

### 3.5 循环处理

遇到有 `loop` 属性的边时：
1. 对 `loop.source` 求值（必须为数组）
2. 对数组每一项执行循环体
3. 循环回边用虚线样式表示

---

## 四、UI 交互

### 4.1 组件状态显示

**状态图标 + 颜色边框：**

| 状态 | 边框颜色 | 图标 | 说明 |
|------|----------|------|------|
| idle    | `#666` 灰色 | 空 | 等待执行 |
| queued  | `#666` 灰色 | 时钟 | 等待上游完成 |
| running | `#4a6fa5` 蓝色 | 旋转 | 执行中 |
| success | `#38a169` 绿色 | 勾 | 执行成功 |
| failed  | `#e53e3e` 红色 | 叉 | 执行失败 |

**进度条：** 节点顶部内嵌进度条，运行时填充动画。

### 4.2 工作流识别高亮

当鼠标悬停某组件时：
- 高亮该组件所在的整个连通子图（所有相关组件和连接线）
- 其他无关组件和连接线降低透明度

### 4.3 属性面板扩展

在现有属性面板中新增"工作流"区块：

```
┌─ 工作流 ──────────────────────────
│ 触发模式: ( ) 手动  (●) 自动
│ 执行引擎: [自动判断 ▼]
│ 输入映射: ${upstream.result}
│
│ [执行此工作流]  [查看执行日志]
└──────────────────────────────────
```

### 4.4 连接线条件编辑

点击连接线，打开属性面板，显示条件/循环配置：

```
┌─ 连接线条件 ────────────────────────
│ 条件表达式:
│   ${upstream.result === 'success'}
│
│ [ ] 循环配置
│    循环变量: item
│    迭代来源: ${step-1.result.items}
└──────────────────────────────────
```

---

## 五、执行日志面板

工作流运行时，点击任意节点弹出浮动日志面板：

```
┌─ 执行日志 ──────────────────────── ✕
│ 工作流: wf-2024-04-24-001
│ 状态: 运行中 (2/5 步骤)
│
│ ✓ [1] text-文本处理  0.8s
│   输入: "Hello world"
│   输出: "你好世界"
│
│ → [2] skill-翻译  3.2s
│   状态: running...
│   输入: "Hello world"
│
│ ○ [3] http-通知  等待中
│
│ [重新执行]  [停止]  [导出日志]
└──────────────────────────────────
```

执行完成后，**自动将完整日志发送到 Hermes 聊天区**作为一条消息，格式：

```
🖥️ **工作流执行完成** — 翻译工作流

✅ 全部完成（5步骤，耗时 4.2s）

1. ✓ text-文本处理  0.8s
   → "你好世界"

2. ✓ skill-翻译  3.2s
   → "Hello你好世界"

3. → http-通知  0.2s
   → 状态: 200 OK

耗时: 4.2s | 成本: $0.03 | 引擎: Hermes+内置
```

---

## 六、用户交互流程

### 6.1 创建工作流

1. 在画布上放置多个组件（text、skill 等）
2. 从组件 A 拖出连接线到组件 B
3. 再从 B 拖到 C → 自动形成 A→B→C 工作流链
4. 打开 A 的属性面板，设置 `triggerMode = 'auto'`（可选）
5. 点击任意组件触发执行

### 6.2 条件分支工作流

1. 构建 A→B, A→C 两个分支
2. 点击连接线 A→B，设置 `condition = "${upstream.result === 'success'}"`
3. 点击连接线 A→C，设置 `condition = "${upstream.result === 'failed'}"`
4. 触发执行时，根据上游结果自动走对应分支

### 6.3 删除工作流关系

1. 选中 A 和 B 之间的连接线，按 Delete
2. A 和 B 立刻解除上下游关系，各自变为独立组件
3. 工作流链断开，重新计算连通子图

---

## 七、文件变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `static/canvas-workflow.js` | 工作流执行引擎（拓扑排序、混合运行时、日志面板）|
| `static/canvas-workflow.css` | 工作流相关样式（状态图标、进度条高亮、执行日志面板）|

### 修改文件

| 文件 | 变更 |
|------|------|
| `static/canvas.html` | 新增 triggerMode/engine/inputMapping UI；工作流高亮逻辑 |
| `static/canvas.js` | 新增工作流执行函数；状态更新；属性面板扩展；连接线条件编辑 |
| `static/canvas.css` | `.comp-*` 新增 status 边框色；`.connection` 条件/循环边样式 |
| `static/canvas-api.js` | 新增 `/api/workflow/execute` 调用 |
| `api/routes.py` | 新增 `/api/workflow/execute` 路由，代理 Hermes Agent / 内置运行时 |
| `api/helpers.py` | CSP 保持不变 |

---

## 八、技术约束

1. **无循环依赖：** 拓扑排序前检测是否存在环，如果存在则报错提示用户
2. **执行超时：** Hermes Agent 调用超时 60s，内置运行时 HTTP 请求超时 30s
3. **数据大小限制：** 传递的上下文总大小不超过 1MB，超出时截断并警告
4. **并发执行：** 同一工作流同时只能有一个执行实例，重复触发时排队或忽略
5. **画布数据持久化：** 每次组件状态变更（status/progress/result）后触发 auto-save

---

## 九、已解决的设计问题

- Q: 连接线触发语义？→ 连接线定义工作流，删除即解除
- Q: 谁来运行？→ 混合引擎，默认按类型判断，可手动覆盖
- Q: 结果流向？→ 发送到 Hermes 聊天区
- Q: 如何触发？→ 点击组件触发，自动拓扑排序执行
- Q: 组件如何知道数据传给谁？→ 自动猜测 + 手动映射兜底
- Q: 传递什么数据？→ 带结构的执行上下文（含 metadata）
- Q: 多工作流冲突？→ 弹窗让用户选择执行哪个
