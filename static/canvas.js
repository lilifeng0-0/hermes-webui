// 万能画布 - 主逻辑 (Vue 3)
// 这个文件会在 canvas.html 加载后执行

(function() {
  'use strict';

  const { createApp } = Vue;

  // ── 全局状态（供父页面 messages.js 调用）──────────────────────────────
  window.CANVAS_ACTIVE = false;
  window.CANVAS_SELECTED = [];
  window.CANVAS_GET_COMPONENT = null;
  window.CANVAS_EXECUTE_ACTION = null;

  const app = createApp({
    data() {
      return {
        canvas: null,
        zoom: 1.0,
        panX: 0,
        panY: 0,
        tool: 'select',
        selectedIds: [],
        editingTextId: null,
        editingCanvasId: null,
        isPanning: false,
        panStart: { x: 0, y: 0 },
        panStartXY: { x: 0, y: 0 },
        drawingRect: null,
        marquee: null, // 框选
        _marqueeJustPerformed: false, // 标记刚完成框选，防止 onCanvasClick 误清空选区
        componentStartPos: null,
        showZoomMenu: false,
        showSelectMenu: false,
        showSkillsDropdown: false,
        skills: [],
        clipboard: null,
        undoStack: [],
        redoStack: [],
        maxUndoSteps: 50,
        contextMenu: { visible: false, x: 0, y: 0, items: [] },
        draggingConnection: null, // {from, fromPort, currentX, currentY}
        toast: { visible: false, message: '' },
        floatingToolbar: { visible: false, mouseDownX: 0, mouseDownY: 0 },
        toolbarRectBorder: '#333333',
        saveTimer: null,
        toasts: [],
        canvasAreaWidth: 3000,
        canvasAreaHeight: 2000,
      };
    },

    computed: {
      currentComponents() {
        if (!this.canvas || !this.canvas.activeCanvasId) return [];
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        return tab ? tab.components : [];
      },
      currentConnections() {
        if (!this.canvas || !this.canvas.activeCanvasId) return [];
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        return tab ? tab.connections : [];
      },
      floatingToolbarScreen() {
        if (!this.floatingToolbar.visible) return null;
        if (this.selectedIds.length === 1) {
          const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
          if (comp) {
            // 工具栏现在在 .canvas-transform 内部（继承 transform: translate(-panX*zoom,-panY*zoom) scale(zoom)）
            // 所以用 canvas 坐标直接定位，自动完成缩放
            // 工具栏居中于组件顶部上方
            return { left: comp.x + comp.width / 2 - 90, top: comp.y - 55 };
          }
        }
        return {
          left: this.floatingToolbar.mouseDownX - 90,
          top: this.floatingToolbar.mouseDownY - 30
        };
      },
      selectedCompType() {
        if (this.selectedIds.length !== 1) return null;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp ? comp.type : null;
      },
      // 多选时所有选中组件的包围框（用于绘制多选边框）
      multiSelectBounds() {
        if (this.selectedIds.length < 2) return null;
        const comps = this.currentComponents.filter(c => this.selectedIds.includes(c.id));
        if (!comps.length) return null;
        const xs = comps.map(c => c.x);
        const ys = comps.map(c => c.y);
        const x2s = comps.map(c => c.x + c.width);
        const y2s = comps.map(c => c.y + c.height);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...x2s) - Math.min(...xs),
          height: Math.max(...y2s) - Math.min(...ys)
        };
      },
      toolbarTextBold() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.bold;
      },
      toolbarTextItalic() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.italic;
      },
      toolbarTextAlign() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.align ? comp.data.align : 'left';
      },
      toolbarTextColor() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.color ? comp.data.color : '#000000';
      },
      toolbarTextFontSize() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.fontSize ? comp.data.fontSize : 16;
      },
      toolbarImageFlipH() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.flipH;
      },
      toolbarImageFlipV() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return comp && comp.data && comp.data.flipV;
      },

      toolbarRectBg() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return (comp && comp.data && comp.data.backgroundColor) ? comp.data.backgroundColor : '#ffffff';
      },
      toolbarRectBorder() {
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        return (comp && comp.data && comp.data.borderColor) ? comp.data.borderColor : '#333333';
      },
      tmpRectRadius: {
        get() {
          const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
          return (comp && comp.data && comp.data.radius) ? comp.data.radius : 0;
        },
        set(val) {
          const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
          if (!comp || comp.type !== 'rect') return;
          if (!comp.data) comp.data = {};
          const v = parseInt(val);
          comp.data.radius = isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
          this.autoSave();
        }
      },
      transformStyle() {
        // 正确公式: screen = zoom * (canvas + pan)
        // 逆变换: canvas = (screen - screenOffset) / zoom - pan
        // CSS: translate(-pan*zoom, -pan*zoom) scale(zoom)
        return {
          transform: `translate(${-this.panX * this.zoom}px, ${-this.panY * this.zoom}px) scale(${this.zoom})`,
        };
      },
    },

    async mounted() {
      // 暴露全局方法
      // Expose to parent window (iframe context)
      window.CANVAS_GET_COMPONENT = (id) => {
        return this.currentComponents.find(c => c.id === id);
      };
      window.CANVAS_EXECUTE_ACTION = (actionStr) => this.executeCanvasAction(actionStr);
      if (window.parent && window.parent !== window) {
        window.parent.CANVAS_GET_COMPONENT = window.CANVAS_GET_COMPONENT;
        window.parent.CANVAS_EXECUTE_ACTION = window.CANVAS_EXECUTE_ACTION;
      }
      this.$watch('selectedIds', (ids) => {
        window.CANVAS_ACTIVE = ids.length > 0;
        window.CANVAS_SELECTED = ids;
      });

      // ── Auto-save: deep watch on canvas data ────────────────────────────
      this.$watch(() => this.canvas, () => {
        if (!this.canvas) return;
        this.scheduleAutoSave();
      }, { deep: true });

      // 注册 beforeunmount (unmount时强制保存)
      this._beforeUnloadHandler = () => {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        if (this.canvas) {
          const data = JSON.stringify(this.canvas);
          navigator.sendBeacon && navigator.sendBeacon('/api/canvas/save', data);
        }
      };
      window.addEventListener('beforeunload', this._beforeUnloadHandler);

      // 加载画布
      await this.loadCanvas();

      // 加载 skills 列表
      this.loadSkillsList();

      // 注册键盘事件
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('mouseup', this.onWindowMouseUp);
      document.addEventListener('click', this.hideContextMenu);
    },

    beforeUnmount() {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('mouseup', this.onWindowMouseUp);
      document.removeEventListener('click', this.hideContextMenu);
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      if (this.saveTimer) clearTimeout(this.saveTimer);
      // Force sync save on unmount
      if (this.canvas) this.saveCanvas();
    },

    methods: {
      // ── 画布加载/保存 ───────────────────────────────────────────
      async loadCanvas() {
        try {
          const data = await CanvasAPI.list();
          if (data.canvases && data.canvases.length > 0) {
            const last = data.canvases[data.canvases.length - 1];
            const loaded = await CanvasAPI.load(last.id);
            this.canvas = loaded.canvas || loaded;
          } else {
            const created = await CanvasAPI.new('我的画布');
            this.canvas = created.canvas;
          }
          this.zoom = this.canvas.zoom || 1.0;
          this.panX = this.canvas.panX || 0;
          this.panY = this.canvas.panY || 0;
        } catch(e) {
          console.error('Failed to load canvas:', e);
          // 离线模式：创建空画布
          this.canvas = {
            id: 'local-' + Date.now(),
            name: '离线画布',
            zoom: 1.0, panX: 0, panY: 0,
            activeCanvasId: 'tab-1',
            canvases: {
              'tab-1': { zoom: 1.0, panX: 0, panY: 0, components: [], connections: [] }
            }
          };
        }
      },

      async saveCanvas() {
        if (!this.canvas) return;
        this.canvas.zoom = this.zoom;
        this.canvas.panX = this.panX;
        this.canvas.panY = this.panY;
        try {
          await CanvasAPI.save(this.canvas);
        } catch(e) {
          console.error('Failed to save canvas:', e);
        }
      },

      scheduleAutoSave() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveCanvas(), 1500);
      },

      // ── 工具 ─────────────────────────────────────────────────────
      setTool(t) {
        this.tool = t;
        this.isPanning = false; // 切换工具时退出移动画布模式
        this.marquee = null;
        this._marqueeJustPerformed = false;
        this.drawingRect = null;
        document.body.style.cursor = 'default';
        this.showSelectMenu = false;
        this.showSkillsDropdown = false;
      },
      toggleSelectMenu() {
        this.showSelectMenu = !this.showSelectMenu;
        this.showSkillsDropdown = false;
      },
      togglePan() {
        this.isPanning = !this.isPanning;
        if (this.isPanning) {
          this.tool = 'select'; // 进入移动模式
        } else {
          this.tool = 'select'; // 退出移动模式
        }
        document.body.style.cursor = this.isPanning ? 'grab' : 'default';
        this.showSelectMenu = false;
      },

      // ── 多画布管理 ────────────────────────────────────────────────
      switchCanvas(cid) {
        if (!this.canvas || !this.canvas.canvases[cid]) return;
        // 保存当前画布缩放/位置
        const current = this.canvas.canvases[this.canvas.activeCanvasId];
        if (current) {
          current.zoom = this.zoom;
          current.panX = this.panX;
          current.panY = this.panY;
        }
        this.canvas.activeCanvasId = cid;
        // 恢复目标画布的缩放/位置
        const target = this.canvas.canvases[cid];
        this.zoom = target.zoom || 1.0;
        this.panX = target.panX || 0;
        this.panY = target.panY || 0;
        this.selectedIds = [];
        this.tool = 'select';
        this.scheduleAutoSave();
      },

      switchToNewTab() {
        // 添加新标签页到当前画布文件（不调用后端）
        if (!this.canvas) return;
        this.pushUndo();
        const tabId = 'tab-' + Date.now();
        const tabName = '新标签 ' + Object.keys(this.canvas.canvases).length;
        this.canvas.canvases[tabId] = {
          name: tabName,
          zoom: 1.0,
          panX: 0,
          panY: 0,
          components: [],
          connections: [],
        };
        this.canvas.activeCanvasId = tabId;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.selectedIds = [];
        this.tool = 'select';
        this.scheduleAutoSave();
        this.showToast('新标签已创建');
      },

      async deleteCanvas(cid) {
        if (Object.keys(this.canvas.canvases).length <= 1) {
          this.showToast('至少保留一个画布'); return;
        }
        if (!confirm('确定删除该画布？')) return;
        this.pushUndo();
        const wasActive = this.canvas.activeCanvasId === cid;
        delete this.canvas.canvases[cid];
        if (wasActive) {
          const nextId = Object.keys(this.canvas.canvases)[0];
          this.switchCanvas(nextId);
        }
        this.scheduleAutoSave();
        this.showToast('画布已删除');
      },

      startRenameCanvas(cid) {
        this.editingCanvasId = cid;
        this.$nextTick(() => {
          const input = this.$el.querySelector('.canvas-tab-rename-input');
          if (input) { input.focus(); input.select(); }
        });
      },

      finishRenameCanvas() {
        this.editingCanvasId = null;
        this.scheduleAutoSave();
      },

      // ── 导出 ─────────────────────────────────────────────────────
      exportCanvas() {
        const data = JSON.stringify(this.canvas, null, 2);
        const blob = new Blob([data], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (this.canvas.name || 'canvas') + '.json';
        a.click();
        URL.revokeObjectURL(url);
      },

      // ── 缩放 ────────────────────────────────────────────────────
      zoomIn() { this.zoom = Math.min(5.0, this.zoom + 0.05); this.showZoomMenu = false; },
      zoomOut() { this.zoom = Math.max(0.1, this.zoom - 0.05); this.showZoomMenu = false; },
      zoomTo(pct) { this.zoom = pct; this.showZoomMenu = false; },
      fitScreen() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.showZoomMenu = false;
      },
      _zoomHideTimer: null,
      scheduleHideZoomMenu() {
        this._zoomHideTimer = setTimeout(() => { this.showZoomMenu = false; }, 200);
      },
      cancelHideZoomMenu() {
        if (this._zoomHideTimer) { clearTimeout(this._zoomHideTimer); this._zoomHideTimer = null; }
      },

      // 全局鼠标事件（平移画布时使用，避免鼠标移出区域后事件中断）
      _onDocMouseMove(e) {
        if (!this.isPanning) return;
        this.panX = this.panStart.x - (e.clientX - this.panStartXY.x) / this.zoom;
        this.panY = this.panStart.y - (e.clientY - this.panStartXY.y) / this.zoom;
      },
      _onDocMouseUp(e) {
        if (!this.isPanning) return;
        this.isPanning = false;
        document.body.style.cursor = 'default';
        document.removeEventListener('mousemove', this._onDocMouseMove);
        document.removeEventListener('mouseup', this._onDocMouseUp);
      },

      onWheel(e) {
        if (this.isPanning) return;
        const area = document.getElementById('canvasArea').getBoundingClientRect();
        // 鼠标在 canvas 区域内的位置（相对于 canvas 左上角）
        const mx = e.clientX - area.left;
        const my = e.clientY - area.top;
        const oldZoom = this.zoom;
        if (e.deltaY < 0) this.zoom = Math.min(5.0, this.zoom + 0.05);
        else this.zoom = Math.max(0.1, this.zoom - 0.05);
        const newZoom = this.zoom;
        if (newZoom !== oldZoom) {
          // 以鼠标位置为中心缩放：调整 pan 使鼠标下的 canvas 坐标保持不变
          const canvasX = mx / oldZoom + this.panX;
          const canvasY = my / oldZoom + this.panY;
          this.panX = canvasX - mx / newZoom;
          this.panY = canvasY - my / newZoom;
        }
      },

      // ── 键盘事件 ─────────────────────────────────────────────────
      onKeyDown(e) {
        if (e.target.contentEditable === 'true' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space' && !this.isPanning) {
          this.isPanning = true;
          // 空格开始平移时，记录当前鼠标位置和当前 pan 值作为起点
          this.panStartXY = { x: e.clientX, y: e.clientY };
          this.panStart = { x: this.panX, y: this.panY };
          document.body.style.cursor = 'grab';
          e.preventDefault();
        }
        if (e.ctrlKey || e.metaKey) {
          if (e.key === 'z') { e.shiftKey ? this.redo() : this.undo(); e.preventDefault(); }
          else if (e.key === 'y') { this.redo(); e.preventDefault(); }
          else if (e.key === 'c') { this.copySelected(); }
          else if (e.key === 'v') { this.paste(); }
          else if (e.key === 'd') { this.duplicateSelected(); }
          else if (e.key === 'a') { this.selectAll(); }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          this.deleteSelected();
        } else if (e.key === 'Escape') {
          this.selectedIds = [];
          this.contextMenu.visible = false;
          this.showSkillsDropdown = false;
        }
      },
      onKeyUp(e) {
        if (e.code === 'Space') {
          this.isPanning = false;
          document.body.style.cursor = 'default';
          document.removeEventListener('mousemove', this._onDocMouseMove);
          document.removeEventListener('mouseup', this._onDocMouseUp);
        }
      },

      // ── 画布鼠标事件 ──────────────────────────────────────────────
      onCanvasMouseDown(e) {
        const areaEl = e.target.closest('#canvasArea, .canvas-transform, .connections-layer');
        if (!areaEl) return;
        const area = document.getElementById('canvasArea').getBoundingClientRect();
        if (this.isPanning) {
          this.panStartXY = { x: e.clientX, y: e.clientY };
          this.panStart = { x: this.panX, y: this.panY };
          document.body.style.cursor = 'grabbing';
          // 全局监听，避免鼠标移出 canvas 区域后事件中断
          document.addEventListener('mousemove', this._onDocMouseMove);
          document.addEventListener('mouseup', this._onDocMouseUp);
        } else if (this.tool === 'rect') {
          const x = (e.clientX - area.left) / this.zoom + this.panX;
          const y = (e.clientY - area.top) / this.zoom + this.panY;
          this.drawingRect = { startX: x, startY: y, currentX: x, currentY: y };
        } else if (this.tool === 'text') {
          // 文本工具由 onCanvasClick 处理
        } else if (this.tool === 'select') {
          const cx = (e.clientX - area.left) / this.zoom + this.panX;
          const cy = (e.clientY - area.top) / this.zoom + this.panY;
          this.marquee = { startX: cx, startY: cy, canvasX: cx, canvasY: cy };
          this.showSelectMenu = false;
        }
      },
      onCanvasMouseMove(e) {
        if (this.isPanning) return; // panning 由 _onDocMouseMove 处理
        const area = document.getElementById('canvasArea').getBoundingClientRect();
        if (this.drawingRect) {
          const rx = (e.clientX - area.left) / this.zoom + this.panX;
          const ry = (e.clientY - area.top) / this.zoom + this.panY;
          this.drawingRect = {...this.drawingRect, currentX: rx, currentY: ry};
        } else if (this.marquee) {
          const cx = (e.clientX - area.left) / this.zoom + this.panX;
          const cy = (e.clientY - area.top) / this.zoom + this.panY;
          this.marquee = {...this.marquee, canvasX: cx, canvasY: cy};
        }
      },
      onCanvasMouseUp(e) {
        if (this.drawingRect) {
          const { startX, startY, currentX, currentY } = this.drawingRect;
          const x = Math.min(startX, currentX);
          const y = Math.min(startY, currentY);
          const w = Math.abs(currentX - startX);
          const h = Math.abs(currentY - startY);
          if (w > 10 && h > 10) {
            this.pushUndo();
            this.addComponent({ type: 'rect', x, y, width: w, height: h, data: {} });
          }
          this.drawingRect = null;
          this.tool = 'select';
        } else if (this.marquee) {
          // 完成框选：marquee 存储的已经是 canvas 坐标，直接用于选区计算
          const m = this.marquee;
          const x1 = Math.min(m.startX, m.canvasX);
          const y1 = Math.min(m.startY, m.canvasY);
          const x2 = Math.max(m.startX, m.canvasX);
          const y2 = Math.max(m.startY, m.canvasY);
          // 选中被框住的组件
          const selected = this.currentComponents.filter(c => {
            return c.x < x2 && c.x + c.width > x1 && c.y < y2 && c.y + c.height > y1;
          }).map(c => c.id);
          if (selected.length > 0) {
            this.selectedIds = selected;
            this._marqueeJustPerformed = true; // 防止点击空白时选区被清除
          }
          this.marquee = null;
        }
      },
      onCanvasClick(e) {
        if (e.target.id === 'canvasArea' || e.target.classList.contains('canvas-transform')) {
          if (this.tool === 'text') {
            const area = document.getElementById('canvasArea').getBoundingClientRect();
            const x = (e.clientX - area.left) / this.zoom + this.panX;
            const y = (e.clientY - area.top) / this.zoom + this.panY;
            this.createTextComponent(x, y);
          } else if (this.tool === 'select' && !this._componentJustSelected && !this._marqueeJustPerformed) {
            // 点击空白处取消选中，并隐藏悬浮工具栏
            this.selectedIds = [];
            this.floatingToolbar.visible = false;
          }
          this._componentJustSelected = false;
          this._marqueeJustPerformed = false;
        }
      },

      // ── 组件鼠标事件 ──────────────────────────────────────────────
      onComponentMouseDown(e, comp) {
        if (this.isPanning) return;
        e.stopPropagation();
        this._componentJustSelected = true; // 防止 onCanvasClick 误清除

        if (!this.selectedIds.includes(comp.id)) {
          if (!e.shiftKey) this.selectedIds = [comp.id];
          else this.selectedIds = [...this.selectedIds, comp.id];
        }

        this.componentStartPos = {
          x: e.clientX,
          y: e.clientY,
          compX: comp.x,
          compY: comp.y,
        };

        const onMove = (ev) => {
          if (!this.componentStartPos || comp.locked) return;
          const dx = (ev.clientX - this.componentStartPos.x) / this.zoom;
          const dy = (ev.clientY - this.componentStartPos.y) / this.zoom;
          comp.x = this.componentStartPos.compX + dx;
          comp.y = this.componentStartPos.compY + dy;
        };
        const onUp = () => {
          if (this.componentStartPos) {
            const didDrag = (this.componentStartPos.x !== e.clientX || this.componentStartPos.y !== e.clientY);
            this.componentStartPos = null;
            this.scheduleAutoSave();
            // 组件点击完成（未拖动）且有选中时显示悬浮工具栏
            if (!didDrag && this.selectedIds.length > 0) {
              this.floatingToolbar.visible = true;
              this.floatingToolbar.mouseDownX = e.clientX;
              this.floatingToolbar.mouseDownY = e.clientY;
            }
          }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },

      // ── 右键菜单 ─────────────────────────────────────────────────
      onContextMenu(e) {
        e.preventDefault();
        const comps = this.selectedIds.map(id => this.currentComponents.find(c => c.id === id)).filter(Boolean);
        const items = this.buildContextMenuItems(comps, e);
        this.contextMenu = { visible: true, x: e.clientX, y: e.clientY, items };
      },
      hideContextMenu() { this.contextMenu.visible = false; },

      // ── Floating Toolbar ──────────────────────────────────────────────────
      onFloatingToolbarMouseUp(e) {
        const dx = Math.abs(e.clientX - this.floatingToolbar.mouseDownX);
        const dy = Math.abs(e.clientY - this.floatingToolbar.mouseDownY);
        if (dx < 3 && dy < 3) {
          // 隐藏工具栏（不在这里重置标志，等 window mouseup 再重置）
          this.floatingToolbar.visible = false;
        }
      },
      onWindowMouseUp(e) {
        // 延迟重置 marquee 标志，等 onCanvasClick 先执行完再清除
        // 否则 onCanvasClick 会在标志检查前就看到 false
        requestAnimationFrame(() => {
          this._componentJustSelected = false;
          this._marqueeJustPerformed = false;
        });
        // 如果工具栏可见且鼠标在工具栏外松开，隐藏工具栏
        if (this.floatingToolbar.visible) {
          const toolbar = document.querySelector('.floating-toolbar');
          if (toolbar) {
            const tr = toolbar.getBoundingClientRect();
            if (e.clientX < tr.left || e.clientX > tr.right || e.clientY < tr.top || e.clientY > tr.bottom) {
              this.floatingToolbar.visible = false;
            }
          }
        }
      },
      syncTmpRectRadius() {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'rect') return;
        if (!comp.data) comp.data = {};
        const v = parseInt(this.tmpRectRadius);
        comp.data.radius = isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
        this.autoSave();
      },
      toolbarSetRectBg(color) {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'rect') return;
        if (!comp.data) comp.data = {};
        comp.data.backgroundColor = color;
        this.autoSave();
      },
      toolbarSetRectBorder(color) {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'rect') return;
        if (!comp.data) comp.data = {};
        comp.data.borderColor = color;
        this.autoSave();
      },
      toolbarSetBold() {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'text') return;
        if (!comp.data) comp.data = {};
        comp.data.bold = !comp.data.bold;
        this.autoSave();
      },
      toolbarSetItalic() {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'text') return;
        if (!comp.data) comp.data = {};
        comp.data.italic = !comp.data.italic;
        this.autoSave();
      },
      toolbarSetAlign(align) {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'text') return;
        if (!comp.data) comp.data = {};
        comp.data.align = align;
        this.autoSave();
      },
      toolbarSetTextColor(color) {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'text') return;
        if (!comp.data) comp.data = {};
        comp.data.color = color;
        this.autoSave();
      },
      toolbarSetFontSize(size) {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'text') return;
        if (!comp.data) comp.data = {};
        comp.data.fontSize = parseInt(size);
        this.autoSave();
      },
      toolbarFlipH() {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'image') return;
        if (!comp.data) comp.data = {};
        comp.data.flipH = !comp.data.flipH;
        this.autoSave();
      },
      toolbarFlipV() {
        if (this.selectedIds.length !== 1) return;
        const comp = this.currentComponents.find(c => c.id === this.selectedIds[0]);
        if (!comp || comp.type !== 'image') return;
        if (!comp.data) comp.data = {};
        comp.data.flipV = !comp.data.flipV;
        this.autoSave();
      },
      toolbarBringFront() {
        if (this.selectedIds.length === 0) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const maxZ = Math.max(0, ...tab.components.map(c => c.z || 0));
        this.selectedIds.forEach(id => {
          const comp = tab.components.find(c => c.id === id);
          if (comp) comp.z = maxZ + 1;
        });
        this.autoSave();
      },
      toolbarSendBack() {
        if (this.selectedIds.length === 0) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const minZ = Math.min(0, ...tab.components.map(c => c.z || 0));
        this.selectedIds.forEach(id => {
          const comp = tab.components.find(c => c.id === id);
          if (comp) comp.z = minZ - 1;
        });
        this.autoSave();
      },
      toolbarDuplicate() {
        if (this.selectedIds.length === 0) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const newIds = [];
        this.selectedIds.forEach(id => {
          const src = tab.components.find(c => c.id === id);
          if (!src) return;
          const copy = JSON.parse(JSON.stringify(src));
          copy.id = 'comp-' + Date.now() + '_dup';
          copy.x += 20;
          copy.y += 20;
          tab.components.push(copy);
          newIds.push(copy.id);
        });
        this.selectedIds = newIds;
        this.autoSave();
      },
      toolbarDelete() {
        if (this.selectedIds.length === 0) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        tab.components = tab.components.filter(c => !this.selectedIds.includes(c.id));
        this.selectedIds = [];
        this.floatingToolbar.visible = false;
        this.autoSave();
      },
      toolbarAlignComps(direction) {
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab || this.selectedIds.length < 2) return;
        const comps = this.selectedIds.map(id => tab.components.find(c => c.id === id)).filter(Boolean);
        if (direction === 'h') {
          const avgY = comps.reduce((s, c) => s + c.y, 0) / comps.length;
          comps.forEach(c => c.y = avgY);
        } else {
          const avgX = comps.reduce((s, c) => s + c.x, 0) / comps.length;
          comps.forEach(c => c.x = avgX);
        }
        this.autoSave();
      },
      toolbarDistributeComps(direction) {
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab || this.selectedIds.length < 3) return;
        let comps = this.selectedIds.map(id => tab.components.find(c => c.id === id)).filter(Boolean);
        if (direction === 'h') {
          comps.sort((a, b) => a.x - b.x);
          const minX = comps[0].x, maxX = comps[comps.length - 1].x;
          const step = (maxX - minX) / (comps.length - 1);
          comps.forEach((c, i) => c.x = minX + step * i);
        } else {
          comps.sort((a, b) => a.y - b.y);
          const minY = comps[0].y, maxY = comps[comps.length - 1].y;
          const step = (maxY - minY) / (comps.length - 1);
          comps.forEach((c, i) => c.y = minY + step * i);
        }
        this.autoSave();
      },

      buildContextMenuItems(comps, e) {
        const isMulti = comps.length > 1;
        const isEmpty = comps.length === 0;
        let items = [];
        if (isEmpty) {
          items = [
            { label: '粘贴', disabled: !this.clipboard, action: () => this.paste() },
            { divider: true },
            { label: '放大', action: () => this.zoomIn() },
            { label: '缩小', action: () => this.zoomOut() },
            { label: '缩放至100%', action: () => this.zoomTo(1.0) },
          ];
        } else if (isMulti) {
          items = [
            { label: '左对齐', action: () => this.alignSelected('left') },
            { label: '水平居中', action: () => this.alignSelected('center_h') },
            { label: '右对齐', action: () => this.alignSelected('right') },
            { label: '顶端对齐', action: () => this.alignSelected('top') },
            { label: '垂直居中', action: () => this.alignSelected('center_v') },
            { label: '底端对齐', action: () => this.alignSelected('bottom') },
            { divider: true },
            { label: '横向分布', action: () => this.distributeSelected('horizontal') },
            { label: '纵向分布', action: () => this.distributeSelected('vertical') },
          ];
        } else {
          const comp = comps[0];
          items = [
            { label: '复制', action: () => this.copySelected() },
            { label: '剪切', action: () => this.cutSelected() },
            { label: '粘贴', disabled: !this.clipboard, action: () => this.paste() },
            { label: '创建副本', action: () => this.duplicateSelected() },
            { divider: true },
            { label: '发送至对话', action: () => this.sendToChat(comp) },
            { label: comp.locked ? '解锁' : '锁定', action: () => this.toggleLock(comp) },
          ];
          if (comp.type === 'text') {
            items.push({ divider: true }, { label: '转为便签', action: () => this.convertToNote(comp) });
          }
          if (comp.type === 'image') {
            items.push(
              { divider: true },
              { label: '水平翻转', action: () => this.flipImage(comp, 'h') },
              { label: '垂直翻转', action: () => this.flipImage(comp, 'v') },
              { label: '导出', action: () => this.exportComponent(comp) }
            );
          }
          if (comp.type === 'video') {
            items.push(
              { divider: true },
              { label: '镜像', action: () => this.mirrorVideo(comp) },
              { label: '导出', action: () => this.exportComponent(comp) }
            );
          }
        }
        return items;
      },

      // ── 组件操作 ─────────────────────────────────────────────────
      addComponent(comp) {
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const newComp = {
          id: 'comp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          locked: false,
          ...comp,
        };
        tab.components.push(newComp);
        this.scheduleAutoSave();
        return newComp;
      },

      createTextComponent(x, y) {
        this.pushUndo();
        const comp = this.addComponent({
          type: 'text',
          x, y,
          width: 200,
          height: 40,
          data: { content: '', color: '#333', fontSize: 16, fontFamily: 'sans-serif', align: 'left', bold: false, italic: false }
        });
        this.selectedIds = [comp.id];
        this.$nextTick(() => { this.editingTextId = comp.id; });
        this.tool = 'select';
      },

      startTextEdit(comp) {
        this.editingTextId = comp.id;
      },
      finishTextEdit(comp) {
        this.editingTextId = null;
        this.pushUndo();
      },

      getComponentStyle(comp) {
        let transforms = [];
        if (comp.type === 'image' && comp.data.flipH) transforms.push('scaleX(-1)');
        if (comp.type === 'video' && comp.data.mirrored) transforms.push('scaleX(-1)');
        let style = {
          left: comp.x + 'px',
          top: comp.y + 'px',
          width: comp.width + 'px',
          height: comp.height + 'px',
        };
        // 矩形：应用背景色、边框、圆角
        if (comp.type === 'rect') {
          style.backgroundColor = (comp.data && comp.data.backgroundColor) ? comp.data.backgroundColor : '#ffffff';
          style.border = (comp.data && comp.data.borderColor)
            ? `1px solid ${comp.data.borderColor}`
            : '1px solid #333333';
          style.borderRadius = (comp.data && comp.data.radius) ? comp.data.radius + 'px' : '0px';
        }
        if (transforms.length) {
          style.transform = transforms.join(' ');
        }
        return style;
      },

      getTextStyle(data) {
        return {
          color: data.color || '#333',
          fontSize: (data.fontSize || 16) + 'px',
          fontFamily: data.fontFamily || 'sans-serif',
          textAlign: data.align || 'left',
          fontWeight: data.bold ? 'bold' : 'normal',
          fontStyle: data.italic ? 'italic' : 'normal',
        };
      },

      // ── 撤销/重做 ─────────────────────────────────────────────────
      pushUndo() {
        if (!this.canvas) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const snapshot = JSON.stringify({ components: tab.components, connections: tab.connections });
        this.undoStack.push(snapshot);
        if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
        this.redoStack = [];
      },
      undo() {
        if (!this.undoStack.length) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const current = JSON.stringify({ components: tab.components, connections: tab.connections });
        this.redoStack.push(current);
        const prev = JSON.parse(this.undoStack.pop());
        tab.components = prev.components;
        tab.connections = prev.connections;
        this.scheduleAutoSave();
      },
      redo() {
        if (!this.redoStack.length) return;
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        const current = JSON.stringify({ components: tab.components, connections: tab.connections });
        this.undoStack.push(current);
        const next = JSON.parse(this.redoStack.pop());
        tab.components = next.components;
        tab.connections = next.connections;
        this.scheduleAutoSave();
      },

      // ── 复制/粘贴/删除 ───────────────────────────────────────────
      copySelected() {
        if (!this.selectedIds.length) return;
        this.clipboard = this.selectedIds.map(id => {
          const c = this.currentComponents.find(x => x.id === id);
          return c ? JSON.parse(JSON.stringify(c)) : null;
        }).filter(Boolean);
      },
      cutSelected() {
        this.copySelected();
        this.deleteSelected();
      },
      paste() {
        if (!this.clipboard || !this.clipboard.length) return;
        this.pushUndo();
        const newIds = [];
        for (const c of this.clipboard) {
          const nc = JSON.parse(JSON.stringify(c));
          nc.id = 'comp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          nc.x += 20;
          nc.y += 20;
          this.addComponent(nc);
          newIds.push(nc.id);
        }
        this.selectedIds = newIds;
      },
      duplicateSelected() {
        if (!this.selectedIds.length) return;
        this.pushUndo();
        const newIds = [];
        for (const id of this.selectedIds) {
          const c = this.currentComponents.find(x => x.id === id);
          if (!c) continue;
          const nc = JSON.parse(JSON.stringify(c));
          nc.id = 'comp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
          nc.x += 20;
          nc.y += 20;
          this.addComponent(nc);
          newIds.push(nc.id);
        }
        this.selectedIds = newIds;
      },
      deleteSelected() {
        if (!this.selectedIds.length) return;
        this.pushUndo();
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        tab.components = tab.components.filter(c => !this.selectedIds.includes(c.id));
        tab.connections = tab.connections.filter(conn =>
          !this.selectedIds.includes(conn.from) && !this.selectedIds.includes(conn.to)
        );
        this.selectedIds = [];
        this.scheduleAutoSave();
      },
      selectAll() {
        this.selectedIds = this.currentComponents.map(c => c.id);
      },

      // ── 布局操作 ─────────────────────────────────────────────────
      alignSelected(mode) {
        if (this.selectedIds.length < 2) return;
        this.pushUndo();
        const comps = this.selectedIds.map(id => this.currentComponents.find(c => c.id === id)).filter(Boolean);
        const bounds = {
          left: Math.min(...comps.map(c => c.x)),
          right: Math.max(...comps.map(c => c.x + c.width)),
          top: Math.min(...comps.map(c => c.y)),
          bottom: Math.max(...comps.map(c => c.y + c.height)),
          centerX: (Math.min(...comps.map(c => c.x)) + Math.max(...comps.map(c => c.x + c.width))) / 2,
          centerY: (Math.min(...comps.map(c => c.y)) + Math.max(...comps.map(c => c.y + c.height))) / 2,
        };
        for (const c of comps) {
          if (mode === 'left') c.x = bounds.left;
          else if (mode === 'right') c.x = bounds.right - c.width;
          else if (mode === 'center_h') c.x = bounds.centerX - c.width / 2;
          else if (mode === 'top') c.y = bounds.top;
          else if (mode === 'bottom') c.y = bounds.bottom - c.height;
          else if (mode === 'center_v') c.y = bounds.centerY - c.height / 2;
        }
        this.scheduleAutoSave();
      },
      distributeSelected(dir) {
        if (this.selectedIds.length < 3) return;
        this.pushUndo();
        const comps = this.selectedIds.map(id => this.currentComponents.find(c => c.id === id)).filter(Boolean);
        if (dir === 'horizontal') {
          comps.sort((a, b) => a.x - b.x);
          const minX = comps[0].x;
          const maxX = comps[comps.length - 1].x;
          const step = (maxX - minX) / (comps.length - 1);
          comps.forEach((c, i) => { c.x = minX + step * i; });
        } else {
          comps.sort((a, b) => a.y - b.y);
          const minY = comps[0].y;
          const maxY = comps[comps.length - 1].y;
          const step = (maxY - minY) / (comps.length - 1);
          comps.forEach((c, i) => { c.y = minY + step * i; });
        }
        this.scheduleAutoSave();
      },

      // ── 翻转/镜像/锁定 ────────────────────────────────────────────
      flipImage(comp, dir) {
        this.pushUndo();
        if (dir === 'h') comp.data.flipH = !comp.data.flipH;
        else comp.data.flipV = !comp.data.flipV;
        this.scheduleAutoSave();
      },
      mirrorVideo(comp) {
        this.pushUndo();
        comp.data.mirrored = !comp.data.mirrored;
        this.scheduleAutoSave();
      },
      toggleLock(comp) {
        comp.locked = !comp.locked;
        this.scheduleAutoSave();
      },

      // ── 导出 ─────────────────────────────────────────────────────
      exportComponent(comp) {
        if (comp.type === 'image' || comp.type === 'video') {
          const url = '/' + comp.data.path;
          const a = document.createElement('a');
          a.href = url;
          a.download = comp.data.path.split('/').pop();
          a.click();
        }
      },

      // ── 便签转换 ──────────────────────────────────────────────────
      convertToNote(comp) {
        this.pushUndo();
        comp.type = 'note';
        comp.data.content = comp.data.content || '';
        comp.data.color = comp.data.color || '#fff9c4';
        this.scheduleAutoSave();
      },

      // ── Skills ──────────────────────────────────────────────────
      async loadSkillsList() {
        try {
          const resp = await fetch('/api/skills');
          if (!resp.ok) throw new Error('API not available');
          const data = await resp.json();
          this.skills = data.skills || [];
        } catch(e) {
          // 尝试 /api/skills 备用
          try {
            const resp2 = await fetch('/api/skills');
            const data2 = await resp2.json();
            this.skills = data2.skills || [];
          } catch(e2) {
            this.skills = [];
          }
        }
      },
      addSkillToCanvas(skill) {
        this.pushUndo();
        this.addComponent({
          type: 'skill',
          x: 100 + Math.random() * 200,
          y: 100 + Math.random() * 200,
          width: 160,
          height: 80,
          data: { skillName: skill.name, skillDesc: skill.description }
        });
        this.showSkillsDropdown = false;
      },

      // ── 上传图片/视频 ─────────────────────────────────────────────
      triggerImageUpload() {
        console.log('[Canvas] triggerImageUpload called');
        const input = document.getElementById('imageUpload');
        console.log('[Canvas] imageUpload input element:', input);
        input.click();
      },
      triggerVideoUpload() {
        document.getElementById('videoUpload').click();
      },
      async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        console.log('[Canvas] handleImageUpload called, file:', file.name);
        const cid = this.canvas.id;
        console.log('[Canvas] canvas id:', cid);
        const comp = this.addComponent({
          type: 'image',
          x: 100, y: 100,
          width: 200, height: 150,
          data: { uploading: true, progress: 0, fileName: file.name }
        });
        console.log('[Canvas] created component:', comp.id);
        try {
          console.log('[Canvas] uploading...');
          const result = await CanvasAPI.upload(cid, comp.id, file);
          console.log('[Canvas] upload result:', result);
          if (result.error) throw new Error(result.error);
          comp.data = { path: result.path, width: result.width, height: result.height, flipH: false, flipV: false };
          comp.width = Math.min(result.width || 200, 400);
          comp.height = Math.min(result.height || 150, 300);
          this.showToast('图片上传完成');
          this.scheduleAutoSave();
        } catch(err) {
          console.error('[Canvas] upload failed:', err);
          comp.data = { error: err.message };
          this.showToast('上传失败: ' + err.message);
        }
        e.target.value = '';
      },
      async handleVideoUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const cid = this.canvas.id;
        const comp = this.addComponent({
          type: 'video',
          x: 100, y: 100,
          width: 320, height: 180,
          data: { uploading: true, progress: 0, fileName: file.name }
        });
        try {
          const result = await CanvasAPI.upload(cid, comp.id, file);
          comp.data = { path: result.path, width: result.width, height: result.height, duration: result.duration, mirrored: false };
          if (result.width && result.height) {
            const ratio = Math.min(400 / result.width, 300 / result.height);
            comp.width = Math.round(result.width * ratio);
            comp.height = Math.round(result.height * ratio);
          }
          this.showToast('视频上传完成');
          this.scheduleAutoSave();
        } catch(err) {
          comp.data.error = err.message;
          this.showToast('上传失败: ' + err.message);
        }
        e.target.value = '';
      },

      // ── Toast ────────────────────────────────────────────────────
      showToast(msg, duration = 3000) {
        this.toast = { visible: true, message: msg };
        setTimeout(() => { this.toast.visible = false; }, duration);
      },

      // ── Markdown 渲染（简易）─────────────────────────────────────
      renderMarkdown(text) {
        if (!text) return '';
        return text
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/\n/g, '<br>');
      },

      // ── 连接线渲染 ─────────────────────────────────────────────────
      // 计算两个组件之间最近的一对连接点
      _getBestPorts(fromComp, toComp) {
        const ports = ['top', 'right', 'bottom', 'left'];
        let bestPair = { from: 'right', to: 'left', dist: Infinity };
        for (const fp of ports) {
          for (const tp of ports) {
            const fpPos = this.getPortPosition(fromComp, fp);
            const tpPos = this.getPortPosition(toComp, tp);
            const dist = Math.hypot(tpPos.x - fpPos.x, tpPos.y - fpPos.y);
            if (dist < bestPair.dist) {
              bestPair = { from: fp, to: tp, dist };
            }
          }
        }
        return bestPair;
      },

      getConnectionPath(conn) {
        const fromComp = this.currentComponents.find(c => c.id === conn.from);
        const toComp = this.currentComponents.find(c => c.id === conn.to);
        if (!fromComp || !toComp || !fromComp.width || !fromComp.height || !toComp.width || !toComp.height) return '';

        // 自动选择最近的一对连接点（除非连接已指定端口）
        const bestPorts = this._getBestPorts(fromComp, toComp);
        const fromPort = conn.fromPort || bestPorts.from;
        const toPort = conn.toPort || bestPorts.to;

        // 获取连接点坐标
        const fromPos = this.getPortPosition(fromComp, fromPort);
        const toPos = this.getPortPosition(toComp, toPort);

        // 计算控制点偏移（用于贝塞尔曲线）
        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // 根据连接方向选择控制点策略
        let cp1x, cp1y, cp2x, cp2y;

        if (absDx > absDy) {
          // 水平方向为主 - 使用水平贝塞尔
          const offset = Math.max(50, absDx * 0.4);
          if (fromPort === 'right' || fromPort === 'left') {
            cp1x = fromPos.x + (fromPort === 'right' ? offset : -offset);
            cp1y = fromPos.y;
            cp2x = toPos.x + (toPort === 'left' ? -offset : offset);
            cp2y = toPos.y;
          } else {
            cp1x = fromPos.x;
            cp1y = fromPos.y + (fromPort === 'bottom' ? offset : -offset);
            cp2x = toPos.x;
            cp2y = toPos.y + (toPort === 'top' ? -offset : offset);
          }
        } else {
          // 垂直方向为主 - 使用垂直贝塞尔
          const offset = Math.max(50, absDy * 0.4);
          if (fromPort === 'top' || fromPort === 'bottom') {
            cp1x = fromPos.x;
            cp1y = fromPos.y + (fromPort === 'bottom' ? offset : -offset);
            cp2x = toPos.x;
            cp2y = toPos.y + (toPort === 'top' ? -offset : offset);
          } else {
            cp1x = fromPos.x + (fromPort === 'right' ? offset : -offset);
            cp1y = fromPos.y;
            cp2x = toPos.x + (toPort === 'left' ? -offset : offset);
            cp2y = toPos.y;
          }
        }

        return `M ${fromPos.x} ${fromPos.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPos.x} ${toPos.y}`;
      },

      getPortPosition(comp, port) {
        const cx = comp.x + comp.width / 2;
        const cy = comp.y + comp.height / 2;
        switch (port) {
          case 'top': return { x: cx, y: comp.y };
          case 'bottom': return { x: cx, y: comp.y + comp.height };
          case 'left': return { x: comp.x, y: cy };
          case 'right': return { x: comp.x + comp.width, y: cy };
          default: return { x: cx, y: cy };
        }
      },

      getConnectionPorts(conn) {
        const fromComp = this.currentComponents.find(c => c.id === conn.from);
        const toComp = this.currentComponents.find(c => c.id === conn.to);
        if (!fromComp || !toComp || !fromComp.width || !fromComp.height || !toComp.width || !toComp.height) return [];
        const bestPorts = this._getBestPorts(fromComp, toComp);
        const fromPort = conn.fromPort || bestPorts.from;
        const toPort = conn.toPort || bestPorts.to;
        const fromPos = this.getPortPosition(fromComp, fromPort);
        const toPos = this.getPortPosition(toComp, toPort);
        return [
          { id: conn.id + '-from', cx: fromPos.x, cy: fromPos.y },
          { id: conn.id + '-to', cx: toPos.x, cy: toPos.y }
        ];
      },

      onConnectionClick(conn) {
        // 选中连接线（通过选中起点或终点组件）
        if (!this.selectedIds.includes(conn.from)) {
          this.selectedIds = [conn.from, conn.to];
        }
        this._rightClickedConn = conn;
      },

      onConnectionContextMenu(e, conn) {
        e.preventDefault();
        this._rightClickedConn = conn;
        this.contextMenu = {
          visible: true,
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: '删除连接', action: () => this.deleteConnection(conn.id) },
          ],
        };
      },

      deleteConnection(connId) {
        this.pushUndo();
        const tab = this.canvas.canvases[this.canvas.activeCanvasId];
        if (!tab) return;
        tab.connections = tab.connections.filter(c => c.id !== connId);
        this.scheduleAutoSave();
        this.showToast('连接已删除');
      },

      // ── 连接线拖拽创建 ──────────────────────────────────────────────
      onPortMouseDown(e, comp, port) {
        if (this.tool !== 'connect' && e.button !== 0) return;
        e.stopPropagation();
        const area = document.getElementById('canvasArea').getBoundingClientRect();
        const startX = (e.clientX - area.left) / this.zoom + this.panX;
        const startY = (e.clientY - area.top) / this.zoom + this.panY;
        this.draggingConnection = {
          from: comp.id,
          fromPort: port,
          currentX: startX,
          currentY: startY,
        };

        const onMove = (ev) => {
          if (!this.draggingConnection) return;
          const mx = (ev.clientX - area.left) / this.zoom + this.panX;
          const my = (ev.clientY - area.top) / this.zoom + this.panY;
          this.draggingConnection.currentX = mx;
          this.draggingConnection.currentY = my;
        };

        const onUp = (ev) => {
          if (!this.draggingConnection) return;
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const portEl = el ? el.closest('.comp-port') : null;
          if (portEl) {
            const targetCompEl = portEl.closest('.canvas-component');
            if (targetCompEl) {
              const cid = targetCompEl.getAttribute('data-comp-id');
              if (cid && cid !== this.draggingConnection.from) {
                this.pushUndo();
                const tab = this.canvas.canvases[this.canvas.activeCanvasId];
                if (!tab.connections) tab.connections = [];
                const exists = tab.connections.some(
                  c => c.from === this.draggingConnection.from && c.to === cid
                );
                if (!exists) {
                  tab.connections.push({
                    id: 'conn-' + Date.now(),
                    from: this.draggingConnection.from,
                    to: cid,
                    fromPort: this.draggingConnection.fromPort,
                    toPort: portEl.getAttribute('data-port'),
                  });
                  this.scheduleAutoSave();
                  this.showToast('连接已创建');
                }
              }
            }
          }
          this.draggingConnection = null;
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },

      getTempConnectionPath() {
        if (!this.draggingConnection) return '';
        const fromComp = this.currentComponents.find(c => c.id === this.draggingConnection.from);
        if (!fromComp) return '';
        const fromPos = this.getPortPosition(fromComp, this.draggingConnection.fromPort);
        const { currentX, currentY } = this.draggingConnection;
        const dx = currentX - fromPos.x;
        const dy = currentY - fromPos.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let cp1x, cp1y, cp2x, cp2y;
        const offset = Math.max(30, Math.max(absDx, absDy) * 0.4);
        if (absDx >= absDy) {
          cp1x = fromPos.x + (dx > 0 ? offset : -offset);
          cp1y = fromPos.y;
          cp2x = currentX + (dx > 0 ? -offset : offset);
          cp2y = currentY;
        } else {
          cp1x = fromPos.x;
          cp1y = fromPos.y + (dy > 0 ? offset : -offset);
          cp2x = currentX;
          cp2y = currentY + (dy > 0 ? -offset : offset);
        }
        return `M ${fromPos.x} ${fromPos.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${currentX} ${currentY}`;
      },

      // ── Skill 拖拽 ─────────────────────────────────────────────────
      onSkillDragStart(e, skill) {
        e.dataTransfer.setData('skill', JSON.stringify(skill));
        e.dataTransfer.effectAllowed = 'copy';
        this._draggingSkill = skill;
      },

      onSkillDragEnd() {
        this._draggingSkill = null;
      },

      onCanvasDragOver(e) {
        if (this._draggingSkill) {
          e.dataTransfer.dropEffect = 'copy';
        }
      },

      onCanvasDrop(e) {
        const skillData = e.dataTransfer.getData('skill');
        if (!skillData) return;
        try {
          const skill = JSON.parse(skillData);
          const area = document.getElementById('canvasArea').getBoundingClientRect();
          const x = (e.clientX - area.left) / this.zoom + this.panX;
          const y = (e.clientY - area.top) / this.zoom + this.panY;
          this.pushUndo();
          const tab = this.canvas.canvases[this.canvas.activeCanvasId];
          const comp = {
            id: 'comp-' + Date.now(),
            type: 'skill',
            x: x - 80,
            y: y - 30,
            width: 160,
            height: 60,
            locked: false,
            data: { skillName: skill.name, skillDesc: skill.description },
          };
          tab.components.push(comp);
          this.selectedIds = [comp.id];
          this.scheduleAutoSave();
          this.showToast('Skill 已添加到画布');
        } catch(err) {
          console.error('Failed to add skill:', err);
        }
        this._draggingSkill = null;
      },

      // ── Hermes 交互 ──────────────────────────────────────────────
      async sendToChat(comp) {
        let text = '';
        let files = [];
        if (comp.type === 'image' || comp.type === 'video') {
          try {
            // 先将文件上传为聊天附件
            const fileResp = await fetch('/' + comp.data.path);
            const blob = await fileResp.blob();
            const fd = new FormData();
            fd.append('file', blob, comp.data.path.split('/').pop());
            const uploadResp = await fetch('/api/upload', { method: 'POST', body: fd });
            const uploadData = await uploadResp.json();
            if (uploadData.filename) files = [uploadData.filename];
            text = `【画布发来的${comp.type === 'image' ? '图片' : '视频'}】`;
          } catch(e) {
            text = `【画布发来的${comp.type === 'image' ? '图片' : '视频'}】(${comp.data.path})`;
          }
        } else if (comp.type === 'text' || comp.type === 'note') {
          text = `【画布发来的内容】\n\n${comp.data.content}`;
        } else if (comp.type === 'skill') {
          text = `【画布 Skill】${comp.data.skillName}：${comp.data.skillDesc}`;
        }
        if (window.parent !== window) {
          window.parent.postMessage({ type: 'canvas-send-to-chat', text, files }, '*');
        }
      },

      executeCanvasAction(actionStr) {
        this.pushUndo();
        const layoutMatch = actionStr.match(/(\w+):\s*ids=([\w-,]+)/);
        if (layoutMatch) {
          const [, op, idsStr] = layoutMatch;
          const ids = idsStr.split(',').map(s => s.trim());
          const comps = ids.map(id => this.currentComponents.find(c => c.id === id)).filter(Boolean);
          if (['left_align','right_align','center_h','center_v','top_align','bottom_align'].includes(op)) {
            const mode = {left_align:'left',right_align:'right',center_h:'center_h',center_v:'center_v',top_align:'top',bottom_align:'bottom'}[op];
            this.alignSelected(mode);
          } else if (op === 'horizontal_distribute') {
            this.distributeSelected('horizontal');
          } else if (op === 'vertical_distribute') {
            this.distributeSelected('vertical');
          }
        }
        const compOpMatch = actionStr.match(/(\w+):\s*id=([\w-]+)/);
        if (compOpMatch) {
          const [, op, id] = compOpMatch;
          const comp = this.currentComponents.find(c => c.id === id);
          if (!comp) return;
          if (op === 'delete_component') {
            this.selectedIds = [id];
            this.deleteSelected();
          } else if (op === 'duplicate_component') {
            this.selectedIds = [id];
            this.duplicateSelected();
          } else if (op === 'export_image' || op === 'export_video') {
            this.exportComponent(comp);
          } else if (op === 'update_component') {
            // 解析类型和数据
            const typeMatch = actionStr.match(/type=(\w+)/);
            const dataMatch = actionStr.match(/data=({.*})/);
            if (typeMatch) comp.type = typeMatch[1];
            if (dataMatch) {
              try { comp.data = JSON.parse(dataMatch[1]); } catch(e) {}
            }
            this.scheduleAutoSave();
          }
        }
      },
    },
  });

  app.mount('#app');
})();
