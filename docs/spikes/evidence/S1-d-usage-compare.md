# S1 — headless utilization vs interactive /usage (2026-11-02, claude 2.1.312)

| source | time | 5h | weekly | 5h resets | weekly resets |
|---|---|---|---|---|---|
| headless stream-json `rate_limit_event` | 16:34 CET | 0.02 | 0.09 | 18:30 (1793640600) | Sun Nov 8 05:00 (1794110400) |
| interactive `/usage` (Aziz screenshot) | ~16:30 CET | 2% | 10% | 6:30 PM | Sun Nov 8 05:00 |

- `utilization` is a fraction (0.02 = 2%). Reset times match exactly.
- Weekly differs by 1pp (0.09 vs 10%): rounding/truncation or a sub-minute timing gap. Treat error margin as +-1pp.
- Earlier reading at 11:24 CET showed five_hour 0.15 resetting 13:10: the window had rolled over by 16:30.
