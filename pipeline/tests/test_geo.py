"""Tests for the geometry + de-duplication core."""

import unittest

from pipeline.core.geo import (
    bbox_of, dedupe_sites, haversine_mi, norm_name, simplify_geometry,
)


def site(sid, name, lng, lat, **extra):
    return {"id": sid, "name": name, "lng": lng, "lat": lat, "_source": sid, **extra}


class TestDistance(unittest.TestCase):
    def test_zero_distance(self):
        self.assertEqual(haversine_mi((-86, 40), (-86, 40)), 0)

    def test_degree_of_latitude_is_about_69_miles(self):
        d = haversine_mi((-86, 40), (-86, 41))
        self.assertGreater(d, 68)
        self.assertLess(d, 70)


class TestBbox(unittest.TestCase):
    def test_polygon_bbox(self):
        geom = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]]]}
        self.assertEqual(bbox_of(geom), (0, 0, 2, 3))

    def test_empty_geometry_returns_none(self):
        self.assertIsNone(bbox_of({"type": "Polygon", "coordinates": []}))


class TestNormName(unittest.TestCase):
    def test_strips_filler_words(self):
        # "Data Center"/"Campus"/"LLC" carry no identifying signal
        self.assertEqual(norm_name("Acme Data Center"), "acme")
        self.assertEqual(norm_name("Acme Datacentre Campus LLC"), "acme")

    def test_handles_missing_name(self):
        self.assertEqual(norm_name(None), "")


class TestDedupe(unittest.TestCase):
    def test_merges_same_site_named_differently(self):
        out = dedupe_sites([
            site("a", "Acme Data Center", -86.5, 39.7),
            site("b", "Acme Datacenter Campus", -86.4985, 39.7),
        ])
        self.assertEqual(len(out), 1)
        self.assertIn("b", out[0]["_merged_from"])

    def test_keeps_distinct_sites_apart(self):
        out = dedupe_sites([
            site("a", "Acme DC", -86.5, 39.7),
            site("b", "Other DC", -85.0, 39.7),
        ])
        self.assertEqual(len(out), 2)

    def test_does_not_merge_neighbors_with_different_names(self):
        # CyrusOne CIN2 and CIN3 are real, distinct, and close together
        out = dedupe_sites([
            site("a", "CyrusOne Cincinnati-Mason CIN3", -84.30, 39.36),
            site("b", "CyrusOne Cincinnati-Lebanon CIN2", -84.25, 39.40),
        ], radius_mi=1.2)
        self.assertEqual(len(out), 2)

    def test_merges_colocated_sites_regardless_of_name(self):
        # same campus mapped twice under different operators
        out = dedupe_sites([
            site("a", "Meta Data Center", -82.7533, 40.0656),
            site("b", "Central Ohio Transit", -82.7534, 40.0656),
        ], radius_mi=1.2)
        self.assertEqual(len(out), 1)

    def test_curated_record_wins_over_auto(self):
        out = dedupe_sites([
            site("auto", "Acme Data Center", -86.5, 39.7, _auto=True),
            site("cur", "Acme Data Center", -86.5001, 39.7, _curated=True, mw_full=500),
        ])
        self.assertEqual(len(out), 1)
        self.assertTrue(out[0].get("_curated"))
        self.assertEqual(out[0]["mw_full"], 500)

    def test_merge_fills_gaps_without_overwriting(self):
        out = dedupe_sites([
            site("a", "Acme Data Center", -86.5, 39.7, _curated=True, mw_full=500, city=""),
            site("b", "Acme Data Center", -86.5001, 39.7, city="Springfield", acres=100),
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["mw_full"], 500)        # curated value preserved
        self.assertEqual(out[0]["city"], "Springfield")  # gap filled from the other
        self.assertEqual(out[0]["acres"], 100)

    def test_survives_records_with_no_coordinates(self):
        out = dedupe_sites([{"id": "a", "name": "No coords"}, site("b", "Fine", -86, 40)])
        self.assertEqual(len(out), 2)

    def test_empty_input(self):
        self.assertEqual(dedupe_sites([]), [])


class TestSimplify(unittest.TestCase):
    def test_reduces_points_but_keeps_shape(self):
        ring = [[i / 100, 0] for i in range(200)] + [[0, 1], [0, 0]]
        geom = {"type": "Polygon", "coordinates": [ring]}
        out = simplify_geometry(geom, eps=0.01)
        self.assertLess(len(out["coordinates"][0]), len(ring))
        self.assertGreaterEqual(len(out["coordinates"][0]), 3)

    def test_rounds_coordinates(self):
        geom = {"type": "LineString", "coordinates": [[1.123456789, 2.987654321], [3.1, 4.2]]}
        out = simplify_geometry(geom, digits=3)
        self.assertEqual(out["coordinates"][0][0], 1.123)

    def test_leaves_points_untouched(self):
        geom = {"type": "Point", "coordinates": [1, 2]}
        self.assertEqual(simplify_geometry(geom), geom)


if __name__ == "__main__":
    unittest.main()
