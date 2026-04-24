// 画布 API 调用封装
const CanvasAPI = {
  list() {
    return fetch('/api/canvas').then(r => r.json());
  },
  load(id) {
    return fetch('/api/canvas?canvas_id=' + id).then(r => r.json());
  },
  save(data) {
    return fetch('/api/canvas/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({canvas_id: data.id, ...data})
    }).then(r => r.json());
  },
  new(name) {
    return fetch('/api/canvas/new', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: name || '未命名画布'})
    }).then(r => r.json());
  },
  upload(canvasId, componentId, file) {
    const fd = new FormData();
    fd.append('canvas_id', canvasId);
    fd.append('component_id', componentId);
    fd.append('file', file);
    return fetch('/api/canvas/upload', {method: 'POST', body: fd}).then(r => r.json());
  },
  executeWorkflow(nodeId, action = 'run') {
    return fetch('/api/workflow/execute', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({node_id: nodeId, action})
    }).then(r => r.json());
  }
};
