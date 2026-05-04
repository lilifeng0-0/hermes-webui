"""画布工作流执行引擎 - Python 后端

处理 Hermes Agent 调用和内置运行时的 Python 端逻辑。
"""
import json
import os
import signal
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, Optional

_TIMEOUT = 60  # 秒

# 正在运行的 workflow 进程追踪: {node_id: {'proc': Popen, 'start_time': float}}
_runningWorkflows: Dict[str, Dict[str, Any]] = {}


def _find_hermes_bin() -> Optional[str]:
    """查找 hermes 可执行文件路径"""
    import shutil
    # 先尝试 shutil.which (支持 pip install 到任意路径)
    which_bin = shutil.which('hermes')
    if which_bin:
        return which_bin
    # 再检查固定位置
    for candidate in [
        os.getenv("HERMES_WEBUI_AGENT_DIR", ""),
        (Path.home() / ".hermes" / "hermes-agent").as_posix(),
    ]:
        if candidate:
            hb = Path(candidate) / "bin" / "hermes"
            if hb.exists():
                return str(hb)
    return None


def _call_hermes(prompt: str, node_id: str, canvas_id: str = None,
                  model: str = 'default', max_tokens: int = 2000) -> Dict[str, Any]:
    """通过 hermes CLI 执行真实 Agent 调用"""
    import threading

    hermes_bin = _find_hermes_bin()
    if not hermes_bin:
        raise RuntimeError(
            "找不到 hermes 可执行文件。"
            "请设置 HERMES_WEBUI_AGENT_DIR 环境变量指向 hermes-agent 目录，"
            "或确保 ~/.hermes/hermes-agent/bin/hermes 存在。"
        )

    result_container: Dict[str, Any] = {}
    error_container: Dict[str, str] = {}

    def _run():
        try:
            # -Q: quiet mode (仅输出最终回复)
            # -q: 单次查询模式
            args = [hermes_bin, "chat", "-Q", "-q", prompt, "--max-turns", "10"]
            if model and model != 'default':
                args.extend(["-m", model])
            proc = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "NO_COLOR": "1"}
            )

            # 注册到追踪表
            _runningWorkflows[node_id] = {
                'proc': proc,
                'canvas_id': canvas_id,
                'start_time': time.time()
            }

            try:
                stdout, stderr = proc.communicate(timeout=_TIMEOUT)
            finally:
                # 执行完毕，从追踪表移除
                _runningWorkflows.pop(node_id, None)

            if proc.returncode == 0:
                result_container['result'] = stdout.strip()
            else:
                error_container['error'] = stderr.strip() or f"hermes exit {proc.returncode}"
        except subprocess.TimeoutExpired:
            proc.kill()
            _runningWorkflows.pop(node_id, None)
            error_container['error'] = f"调用超时（{_TIMEOUT}秒）"
        except Exception as ex:
            _runningWorkflows.pop(node_id, None)
            error_container['error'] = str(ex)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=_TIMEOUT + 5)

    if error_container:
        raise RuntimeError(error_container['error'])

    return {
        'result': result_container.get('result', ''),
        'metadata': {'engine': 'hermes', 'model': model}
    }


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
    return _call_hermes(prompt, node_id='skill:' + skill_name, canvas_id=None)


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


def stop_node(node_id: str) -> Dict[str, Any]:
    """停止指定节点的运行中的 workflow"""
    entry = _runningWorkflows.get(node_id)
    if not entry:
        return {
            'result': None,
            'metadata': {'action': 'stop', 'engine': 'builtin', 'success': False,
                         'reason': f'节点 {node_id} 当前没有运行中的 workflow'}
        }
    proc = entry['proc']
    try:
        proc.terminate()
        time.sleep(0.1)
        if proc.poll() is None:
            proc.kill()
    except Exception as ex:
        pass
    finally:
        _runningWorkflows.pop(node_id, None)
    return {
        'result': f'已停止节点 {node_id} 的 workflow',
        'metadata': {'action': 'stop', 'engine': 'builtin', 'success': True}
    }


def execute_node(node_id: str, action: str, canvas_id: str = None) -> Dict[str, Any]:
    """
    工作流节点执行入口。

    由 routes.py 的 /api/workflow/execute 调用。
    node_id: 要执行的节点 ID
    action:  "run" 或 "stop"
    canvas_id: 画布 ID（用于加载节点配置）
    """
    if action == 'stop':
        return stop_node(node_id)

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
            result = _call_hermes(prompt, node_id, canvas_id)

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
