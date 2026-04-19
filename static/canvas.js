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
        isPanning: false,
        panStart: { x: 0, y: 0 },
        panStartXY: { x: 0, y: 0 },
        drawingRect: null,
        componentStartPos: null,
        showZoomMenu: false,
        showSkillsDropdown: false,
        skills: [],
        clipboard: null,
        undoStack: [],
        redoStack: [],
        maxUndoSteps: 50,
        contextMenu: { visible: false, x: 0, y: 0, items: [] },
        toast: { visible: false, message: '' },
        saveTimer: null,
        toasts: [],
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
      transformStyle() {
        return {
          transform: `scale(${this.zoom}) translate(${this.panX}px, ${this.panY}px)`,
        };
      },
    },

    async mounted() {
      // 暴露全局方法
      window.CANVAS_GET_COMPONENT = (id) => {
        return this.currentComponents.find(c => c.id === id);
      };
      window.CANVAS_EXECUTE_ACTION = (actionStr) => this.executeCanvasAction(actionStr);
      this.$watch('selectedIds', (ids) => {
        window.CANVAS_ACTIVE = ids.length > 0;
        window.CANVAS_SELECTED = ids;
      });

      // 加载画布
      await this.loadCanvas();

      // 加载 skills 列表
      this.loadSkillsList();

      // 注册键盘事件
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      document.addEventListener('click', this.hideContextMenu);
    },

    beforeUnmount() {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      document.removeEventListener('click', this.hideContextMenu);
      if (this.saveTimer) clearTimeout(this.saveTimer);
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
        this.showSkillsDropdown = false;
      },

      // ── 缩放 ────────────────────────────────────────────────────
      zoomIn() { this.zoom = Math.min(5.0, this.zoom + 0.05); },
      zoomOut() { this.zoom = Math.max(0.1, this.zoom - 0.05); },
      zoomTo(pct) { this.zoom = pct; this.showZoomMenu = false; },
      fitScreen() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.showZoomMenu = false;
      },
      onWheel(e) {
        if (e.deltaY < 0) this.zoomIn();
        else this.zoomOut();
      },

      // ── 键盘事件 ─────────────────────────────────────────────────
      onKeyDown(e) {
        if (e.target.contentEditable === 'true' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space' && !this.isPanning) {
          this.isPanning = true;
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
          this.showSkillsDropdown = false;
        }
      },
      onKeyUp(e) {
        if (e.code === 'Space') {
          this.isPanning = false;
          document.body.style.cursor = 'default';
        }
      },

      // ── 画布鼠标事件 ──────────────────────────────────────────────
      onCanvasMouseDown(e) {
        if (e.target.id !== 'canvasArea' && !e.target.classList.contains('canvas-transform')) return;
        if (this.isPanning) {
          this.panStartXY = { x: e.clientX, y: e.clientY };
          this.panStart = { x: this.panX, y: this.panY };
          document.body.style.cursor = 'grabbing';
        } else if (this.tool === 'rect') {
          const area = document.getElementById('canvasArea').getBoundingClientRect();
          const x = (e.clientX - area.left) / this.zoom;
          const y = (e.clientY - area.top) / this.zoom;
          this.drawingRect = { startX: x, startY: y, currentX: x, currentY: y };
        } else if (this.tool === 'text') {
          // 文本工具由 onCanvasClick 处理
        } else if (this.tool === 'select') {
          this.selectedIds = [];
        }
      },
      onCanvasMouseMove(e) {
        if (this.isPanning) {
          this.panX = this.panStart.x + (e.clientX - this.panStartXY.x) / this.zoom;
          this.panY = this.panStart.y + (e.clientY - this.panStartXY.y) / this.zoom;
        } else if (this.drawingRect) {
          const area = document.getElementById('canvasArea').getBoundingClientRect();
          this.drawingRect.currentX = (e.clientX - area.left) / this.zoom;
          this.drawingRect.currentY = (e.clientY - area.top) / this.zoom;
        }
      },
      onCanvasMouseUp(e) {
        if (this.isPanning) {
          document.body.style.cursor = 'grab';
        } else if (this.drawingRect) {
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
        }
      },
      onCanvasClick(e) {
        if (e.target.id === 'canvasArea' || e.target.classList.contains('canvas-transform')) {
          if (this.tool === 'text') {
            const area = document.getElementById('canvasArea').getBoundingClientRect();
            const x = (e.clientX - area.left) / this.zoom;
            const y = (e.clientY - area.top) / this.zoom;
            this.createTextComponent(x, y);
          }
        }
      },

      // ── 组件鼠标事件 ──────────────────────────────────────────────
      onComponentMouseDown(e, comp) {
        if (this.isPanning) return;
        e.stopPropagation();

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
            this.componentStartPos = null;
            this.scheduleAutoSave();
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
          const resp = await fetch('/api/skills/list');
          const data = await resp.json();
          this.skills = data.skills || [];
        } catch(e) {
          // 离线
          this.skills = [];
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
        document.getElementById('imageUpload').click();
      },
      triggerVideoUpload() {
        document.getElementById('videoUpload').click();
      },
      async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const compId = 'comp-' + Date.now();
        const cid = this.canvas.id;
        const comp = this.addComponent({
          type: 'image',
          x: 100, y: 100,
          width: 200, height: 150,
          data: { uploading: true, progress: 0, fileName: file.name }
        });
        try {
          const result = await CanvasAPI.upload(cid, compId, file);
          comp.data = { path: result.path, width: result.width, height: result.height, flipH: false, flipV: false };
          comp.width = Math.min(result.width || 200, 400);
          comp.height = Math.min(result.height || 150, 300);
          this.showToast('图片上传完成');
          this.scheduleAutoSave();
        } catch(err) {
          comp.data.error = err.message;
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

      // ── Hermes 交互 ──────────────────────────────────────────────
      async sendToChat(comp) {
        let text = '';
        let files = [];
        if (comp.type === 'image' || comp.type === 'video') {
          text = `【画布发来的${comp.type === 'image' ? '图片' : '视频'}】`;
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
