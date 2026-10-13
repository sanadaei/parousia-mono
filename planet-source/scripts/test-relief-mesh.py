"""Small actual CLI checks for bounded reproducible mesh inputs."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).parent / 'experiments' / 'make-relief-mesh.py'

class MeshInputTests(unittest.TestCase):
    def run_mesh(self, output, *args):
        return subprocess.run([sys.executable, str(SCRIPT), str(output), *args], capture_output=True)

    def test_deterministic_resolution_seed_and_unchanged_boundary(self):
        with tempfile.TemporaryDirectory() as d:
            a, b, c = [Path(d) / x for x in ('a.json', 'b.json', 'c.json')]
            for p, seed in ((a, '5'), (b, '5'), (c, '6')):
                self.assertEqual(self.run_mesh(p, '--nodes-per-side', '5', '--seed', seed).returncode, 0)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            x, y = json.loads(a.read_text()), json.loads(c.read_text())
            self.assertEqual(len(x['points']), 25)
            self.assertNotEqual(x['points'][6], y['points'][6])
            self.assertEqual(x['points'][:5], y['points'][:5])
            self.assertIn([0, -10000], x['points'])

    def test_invalid_parameters_never_create_output(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'bad.json'
            for args in [('--nodes-per-side', '257'), ('--nodes-per-side', '4'), ('--extent-m', 'nan'), ('--seed', '-1')]:
                self.assertNotEqual(self.run_mesh(p, *args).returncode, 0)
                self.assertFalse(p.exists())

    def test_existing_file_is_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'saved.json'
            p.write_text('preserve')
            self.assertNotEqual(self.run_mesh(p, '--nodes-per-side', '5').returncode, 0)
            self.assertEqual(p.read_text(), 'preserve')

if __name__ == '__main__':
    unittest.main()
