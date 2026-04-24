"""画布工作流执行引擎 - Python 后端

处理 Hermes Agent 调用和内置运行时的 Python 端逻辑。
"""
import json
import time
import urllib.request
import urllib.error
from typing import Any, Dict, Optional

_API_DIR = Path(__file__).parent.resolve()
_BASE_URL = 'http://localhost:8787'
_TIMEOUT = 60  # 秒


def _call_hermes(prompt: str, model: str = 'default', max_tokens: int = 2000) -> Dict[str, Any]:
    """调用 Hermes Agent Chat API（同步版本）"""
    payload = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens
    }).encode('utf-8')

    req = urllib.request.Request(
        f'{_BASE_URL}/api/chat/completions',
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            return {'result': content}
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        return {'error': f'HTTP {e.code}: {body}'}
    except Exception as e:
        return {'error': str(e)}


def execute_skill(skill_name: str, params: Dict[str, Any], input_data: Any = None) -> Dict[str, Any]:
    """执行指定的 Hermes Skill

    通过提示词让 Agent 调用指定 skill，返回执行结果。
    实际生产中应通过 Skill 系统的原生 API 调用。
    """
    params_str = json.dumps(params, ensure_ascii=False, indent=2)
    input_str = json.dumps(input_data, ensure_ascii=False, indent=2) if input_data is not None else '无'
    prompt = (
        f"请执行技能: {skill_name}\n"
        f"技能参数:\n{params_str}\n"
        f"输入数据:\n{input_str}\n\n"
        f"直接调用该 Skill 并返回完整的执行结果（包含 result 和 metadata）。"
        f"以 JSON 格式返回，字段：result（执行结果）、metadata（类型/duration/engine）。"
    )
    return _call_hermes(prompt)


def run_builtin_http(method: str, url: str, body: str = None) -> Dict[str, Any]:
    """内置运行时: HTTP 请求"""
    start = time.time()
    payload = body.encode('utf-8') if body else None
    headers = {'Content-Type': 'application/json'}
    req = urllib.request.Request(
        url,
        data=payload,
        headers=headers,
        method=method.upper()
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode('utf-8', errors='replace')
            duration = time.time() - start
            return {
                'result': text,
                'metadata': {'status': resp.status, 'duration': duration, 'engine': 'builtin', 'type': 'http'}
            }
    except urllib.error.HTTPError as e:
        duration = time.time() - start
        return {
            'result': None,
            'metadata': {'status': e.code, 'error': str(e), 'duration': duration, 'engine': 'builtin', 'type': 'http'}
        }
    except Exception as e:
        duration = time.time() - start
        return {
            'result': None,
            'metadata': {'error': str(e), 'duration': duration, 'engine': 'builtin', 'type': 'http'}
        }


def run_builtin_wait(delay_ms: int) -> Dict[str, Any]:
    """内置运行时: 延时等待"""
    import time
    start = time.time()
    time.sleep(delay_ms / 1000)
    duration = time.time() - start
    return {
        'result': f'等待了 {delay_ms}ms',
        'metadata': {'duration': duration, 'engine': 'builtin', 'type': 'wait'}
    }


def execute_node(node_id: str, action: str, canvas_id: str = None) -> Dict[str, Any]:
    """
    工作流节点执行入口。

    由 routes.py 的 /api/workflow/execute 调用。
    node_id: 要执行的节点 ID
    action:  "run" 或 "stop"（stop 暂未实现，返回提示）
    canvas_id: 画布 ID（用于加载节点配置）
    """
    if action == 'stop':
        return {
            'result': '停止执行',
            'metadata': {'action': 'stop', 'engine': 'builtin', 'type': 'control'}
        }

    # 从画布数据加载节点配置
    comp_config = _load_node_config(node_id, canvas_id) if canvas_id else _get_fallback_config(node_id)

    engine = comp_config.get('engine', 'auto')
    builtin_type = comp_config.get('builtinType', 'transform')
    input_data = comp_config.get('input', None)

    start = time.time()

    if engine == 'hermes' or (engine == 'auto' and comp_config.get('type') not in ('rect',)):
        # 调用 Hermes Agent
        if comp_config.get('skillName'):
            result = execute_skill(comp_config['skillName'], comp_config.get('params', {}), input_data)
        else:
            prompt = comp_config.get('prompt', f'处理以下输入并返回结果: {input_data}')
            result = _call_hermes(prompt)

        duration = time.time() - start
        result['metadata'] = {
            **result.get('metadata', {}),
            'duration': duration,
            'engine': 'hermes',
            'type': comp_config.get('type', 'agent')
        }
        return result
    else:
        # 内置运行时
        if builtin_type == 'http':
            result = run_builtin_http(
                comp_config.get('method', 'GET'),
                comp_config.get('url', ''),
                comp_config.get('body')
            )
        elif builtin_type == 'wait':
            result = run_builtin_wait(comp_config.get('delay', 1000))
        else:
            # transform 或 unknown
            result = {
                'result': input_data,
                'metadata': {'duration': time.time() - start, 'engine': 'builtin', 'type': builtin_type}
            }
        return result


def _load_node_config(node_id: str, canvas_id: str) -> Dict[str, Any]:
    """从画布数据文件加载节点配置"""
    try:
        from api.canvas import load_canvas
        canvas = load_canvas(canvas_id)
        for tab in canvas.get('canvases', {}).values():
            for comp in tab.get('components', []):
                if comp['id'] == node_id:
                    return {
                        'type': comp.get('type'),
                        'engine': comp.get('data', {}).get('engine', 'auto'),
                        'builtinType': comp.get('data', {}).get('builtinType', 'transform'),
                        'input': None,  # 工作流传入
                        'prompt': comp.get('data', {}).get('prompt'),
                        'skillName': comp.get('data', {}).get('skillName'),
                        'params': comp.get('data', {}).get('params', {}),
                        'method': comp.get('data', {}).get('method', 'GET'),
                        'url': comp.get('data', {}).get('url', ''),
                        'body': comp.get('data', {}).get('body'),
                        'delay': int(comp.get('data', {}).get('delay', 1000)),
                    }
    except Exception:
        pass
    return _get_fallback_config(node_id)


def _get_fallback_config(node_id: str) -> Dict[str, Any]:
    """当无法加载配置时的默认返回（测试用）"""
    return {
        'type': 'unknown',
        'engine': 'hermes',
        'builtinType': 'transform',
        'input': None,
        'prompt': f'处理节点 {node_id}',
    }
