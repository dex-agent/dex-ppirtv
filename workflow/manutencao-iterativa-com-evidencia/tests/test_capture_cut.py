"""Boundary tests for the local consumer; real tool runs are separate receipts."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/capture-cut.py'
spec = importlib.util.spec_from_file_location('capture_cut', SCRIPT)
consumer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(consumer)


class CaptureTests(unittest.TestCase):
    def test_config_rejects_paths_outside_repo(self):
        with self.assertRaises(ValueError):
            consumer.inside_repo('../another-project/graph.db')

    def test_cut_cannot_escape_or_reuse_a_directory(self):
        with self.assertRaises(ValueError):
            consumer.capture('../overwrite')
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'existing'
            output.mkdir()
            with patch.object(consumer, 'read_config', return_value={'receipt_root': '.'}), patch.object(consumer, 'inside_repo', return_value=Path(root)):
                with self.assertRaises(FileExistsError):
                    consumer.capture('existing')

    def test_failed_command_is_preserved_and_propagated(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / 'failure.log'
            commands = []
            result = consumer.subprocess.CompletedProcess(['tool'], 7, b'partial output', b'failure')
            with patch.object(consumer.subprocess, 'run', return_value=result):
                with self.assertRaises(RuntimeError):
                    consumer.run_command(['tool'], output, commands)
            self.assertEqual(commands[0]['exit_code'], 7)
            self.assertEqual(output.read_bytes(), b'partial output')
            self.assertEqual(output.with_suffix('.log.stderr').read_bytes(), b'failure')

    def test_profile_only_contains_fields_supported_by_meter(self):
        config = consumer.read_config()
        profile = json.loads(consumer.inside_repo(config['profile']).read_text(encoding='utf8'))
        self.assertEqual(profile['capabilities'], ['cc'])
        self.assertEqual(profile['thresholds'], {'cc': {'max_per_function': 5}})

    def test_missing_owner_tool_leaves_a_failed_receipt(self):
        with tempfile.TemporaryDirectory() as root:
            config = {'receipt_root': '.'}
            with patch.object(consumer, 'read_config', return_value=config), patch.object(consumer, 'inside_repo', return_value=Path(root)), patch.object(consumer, 'source_manifest', return_value={}), patch.object(consumer, 'digest', side_effect=FileNotFoundError('missing owner tool')):
                self.assertEqual(consumer.capture('missing-tool'), 1)
            receipt = json.loads((Path(root) / 'missing-tool/receipt.json').read_text(encoding='utf8'))
            self.assertEqual(receipt['status'], 'failed')
            self.assertIn('missing owner tool', receipt['error'])


if __name__ == '__main__':
    unittest.main()
