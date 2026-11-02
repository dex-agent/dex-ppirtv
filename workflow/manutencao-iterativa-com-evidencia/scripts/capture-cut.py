"""Capture one PPIRTV maintenance cut using the installed owner tools."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

PACKAGE = Path(__file__).resolve().parents[1]
REPO = PACKAGE.parents[1]
REQUIRED = {'schema', 'version', 'project_id', 'owner', 'graph', 'measurement_roots', 'profile', 'receipt_root', 'contact'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inside_repo(value):
    path = (REPO / value).resolve()
    path.relative_to(REPO)
    return path


def read_config():
    config = json.loads((PACKAGE / 'config.json').read_text(encoding='utf8'))
    if set(config) != REQUIRED or config['schema'] != 'dex.workflow.ppirtv.manutencao.config.v1':
        raise ValueError('invalid maintenance config fields/schema')
    if not config['measurement_roots'] or not isinstance(config['measurement_roots'], list):
        raise ValueError('measurement_roots must be a nonempty list')
    paths = [config['profile'], config['receipt_root'], *config['measurement_roots'], *config['graph'].values()]
    for value in paths:
        inside_repo(value)
    return config


def run_command(command, output, commands):
    started = datetime.now(timezone.utc)
    result = subprocess.run(command, cwd=REPO, capture_output=True)
    output.write_bytes(result.stdout)
    output.with_suffix(output.suffix + '.stderr').write_bytes(result.stderr)
    commands.append({'argv': command, 'started_utc': started.isoformat(),
                     'finished_utc': datetime.now(timezone.utc).isoformat(),
                     'exit_code': result.returncode, 'output': output.name})
    if result.returncode:
        raise RuntimeError(f'command failed ({result.returncode}); see {output.name}')


def source_manifest(config):
    paths = set()
    for root in config['measurement_roots']:
        paths.update(p for p in inside_repo(root).rglob('*') if p.is_file() and p.suffix in {'.ts', '.tsx', '.js', '.mjs', '.py'})
    paths.update([PACKAGE / 'config.json', inside_repo(config['profile']), REPO / 'workflow/RULES.md', PACKAGE / 'RULES.md'])
    return {p.relative_to(REPO).as_posix(): digest(p) for p in sorted(paths)}


def capture(cut):
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', cut):
        raise ValueError('cut must be a kebab-case identifier')
    config = read_config()
    output = inside_repo(config['receipt_root']) / cut
    output.mkdir(parents=True, exist_ok=False)
    registry = Path(os.environ['USERPROFILE']) / '.agents/skills'
    exporter = registry / 'code-review-graph/scripts/crg-snapshot/export_crg_snapshot.py'
    meter = registry / 'dex-complexidade-ciclomatica/scripts/medir_cc.py'
    commands = []
    receipt = {'cut': cut, 'repo_root': str(REPO), 'config': str(PACKAGE / 'config.json'),
               'started_utc': datetime.now(timezone.utc).isoformat(), 'commands': commands,
               'sources_before': source_manifest(config),
               'coverage': 'not_measured', 'new_cycles': 'not_measured', 'status': 'running'}
    try:
        receipt['tools'] = {str(p): digest(p) for p in [exporter, meter]}
        run_command(['code-review-graph', 'update', '--repo', str(REPO), '--data-dir', str(inside_repo(config['graph']['data_dir'])), '--base', 'HEAD'], output / 'crg-update.log', commands)
        run_command([sys.executable, '-B', str(exporter), '--database', str(inside_repo(config['graph']['database'])), '--repo-root', str(REPO), '--output', str(output / 'graph.json')], output / 'export.log', commands)
        for index, root in enumerate(config['measurement_roots']):
            common = [sys.executable, '-B', str(meter), '--escopo', 'projeto', '--raiz', str(inside_repo(root)), '--schema-version', '2', '--format', 'json']
            run_command([*common, '--capabilities', 'cc', '--profile', str(inside_repo(config['profile']))], output / f'metrics-{index}-cc.json', commands)
            run_command([*common, '--capabilities', 'cc,js_ts_nesting'], output / f'metrics-{index}-nesting.json', commands)
        receipt['status'] = 'captured'
    except (OSError, ValueError, RuntimeError) as error:
        receipt['status'] = 'failed'
        receipt['error'] = str(error)
    receipt['sources_after'] = source_manifest(config)
    receipt['sources_stable_between_snapshots'] = receipt['sources_before'] == receipt['sources_after']
    receipt['finished_utc'] = datetime.now(timezone.utc).isoformat()
    receipt['outputs_sha256'] = {p.name: digest(p) for p in sorted(output.iterdir()) if p.is_file()}
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print(json.dumps({'status': receipt['status'], 'receipt': str(output / 'receipt.json')}))
    return 0 if receipt['status'] == 'captured' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cut')
    parser.add_argument('--schema', action='store_true')
    parser.add_argument('--usage', action='store_true')
    args = parser.parse_args()
    if args.schema:
        print((PACKAGE / 'SCHEMA/dex.workflow.ppirtv.manutencao.config.v1.schm.md').read_text(encoding='utf8'))
        return 0
    if args.usage:
        print('CWD repo: python -B workflow/manutencao-iterativa-com-evidencia/scripts/capture-cut.py --cut corte-01\nSaida create-only em config.receipt_root; atualiza CRG existente e consome exporter/medidor owners. Sem verdict/archive/restart.')
        return 0
    if not args.cut:
        parser.error('--cut required (or --help/--schema/--usage)')
    try:
        return capture(args.cut)
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
