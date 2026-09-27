import unittest
from datetime import date

from scripts.build_public_demo import dashboard_ranges


class PublicDemoBuildTests(unittest.TestCase):
    def test_dashboard_ranges_match_december_fiscal_boundary(self):
        ranges = dashboard_ranges(date(2026, 12, 15))

        self.assertIn((date(2026, 12, 1), date(2026, 12, 15)), ranges)
        self.assertIn((date(2026, 11, 1), date(2026, 11, 15)), ranges)
        self.assertIn((date(2025, 12, 1), date(2026, 11, 30)), ranges)
        self.assertEqual(len(ranges), len(set(ranges)))

    def test_dashboard_ranges_clamp_shorter_comparison_months(self):
        ranges = dashboard_ranges(date(2028, 3, 31))

        self.assertIn((date(2028, 2, 1), date(2028, 2, 29)), ranges)
        self.assertIn((date(2027, 3, 1), date(2027, 3, 31)), ranges)


if __name__ == "__main__":
    unittest.main()
