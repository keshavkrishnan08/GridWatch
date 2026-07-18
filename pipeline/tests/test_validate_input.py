"""
Tests for the facilities validator.

The rule that matters most: a facility without a source must fail. That's the
project's central promise, so it gets a test rather than a convention.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_validator(doc, extra_args=()):
    """Run the validator on a temp file; return (exit_code, output)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(doc, fh)
        path = fh.name
    try:
        p = subprocess.run(
            [sys.executable, "-m", "pipeline.validate_input", path, *extra_args],
            cwd=ROOT, capture_output=True, text=True, timeout=60,
        )
        return p.returncode, p.stdout + p.stderr
    finally:
        os.unlink(path)


def good(**over):
    f = {
        "id": "ok", "name": "Fine Site", "lat": 40.0, "lng": -86.0,
        "status": "proposed",
        "sources": [{"label": "Filing", "url": "https://example.com"}],
    }
    f.update(over)
    return f


class TestValidator(unittest.TestCase):
    def test_accepts_a_valid_file(self):
        code, out = run_validator({"facilities": [good()]})
        self.assertEqual(code, 0, out)
        self.assertIn("0 errors", out)

    def test_rejects_facility_without_sources(self):
        code, out = run_validator({"facilities": [good(sources=[])]})
        self.assertEqual(code, 1)
        self.assertIn("source", out.lower())

    def test_rejects_missing_sources_key(self):
        f = good()
        del f["sources"]
        code, _ = run_validator({"facilities": [f]})
        self.assertEqual(code, 1)

    def test_rejects_duplicate_ids(self):
        code, out = run_validator({"facilities": [good(), good()]})
        self.assertEqual(code, 1)
        self.assertIn("duplicate", out.lower())

    def test_rejects_unknown_status(self):
        code, out = run_validator({"facilities": [good(status="maybe")]})
        self.assertEqual(code, 1)
        self.assertIn("status", out.lower())

    def test_rejects_out_of_range_coordinates(self):
        code, out = run_validator({"facilities": [good(lat=999)]})
        self.assertEqual(code, 1)
        self.assertIn("range", out.lower())

    def test_rejects_non_numeric_coordinates(self):
        code, _ = run_validator({"facilities": [good(lat="forty")]})
        self.assertEqual(code, 1)

    def test_rejects_phase_capacity_above_full(self):
        code, out = run_validator({"facilities": [good(mw_phase1=900, mw_full=100)]})
        self.assertEqual(code, 1)
        self.assertIn("exceeds", out.lower())

    def test_rejects_malformed_json(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write("{not json")
            path = fh.name
        try:
            p = subprocess.run(
                [sys.executable, "-m", "pipeline.validate_input", path],
                cwd=ROOT, capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(p.returncode, 1)
            self.assertIn("invalid json", (p.stdout + p.stderr).lower())
        finally:
            os.unlink(path)

    def test_rejects_missing_facilities_array(self):
        code, out = run_validator({"nope": []})
        self.assertEqual(code, 1)

    def test_warns_but_passes_when_capacity_unknown(self):
        # An undisclosed capacity is normal and honest — a warning, not an error.
        code, out = run_validator({"facilities": [good(mw_full=None, acres=None)]})
        self.assertEqual(code, 0, out)
        self.assertIn("warning", out.lower())

    def test_shipped_template_is_valid(self):
        path = os.path.join(ROOT, "templates", "facilities.template.json")
        p = subprocess.run(
            [sys.executable, "-m", "pipeline.validate_input", path],
            cwd=ROOT, capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(p.returncode, 0, p.stdout)

    def test_indiana_dataset_is_valid(self):
        """The reference implementation must always pass its own validator."""
        path = os.path.join(ROOT, "public", "data", "facilities.json")
        subs = os.path.join(ROOT, "public", "data", "counties.geojson")
        p = subprocess.run(
            [sys.executable, "-m", "pipeline.validate_input", path, "--subdivisions", subs],
            cwd=ROOT, capture_output=True, text=True, timeout=120,
        )
        self.assertEqual(p.returncode, 0, p.stdout)


if __name__ == "__main__":
    unittest.main()
