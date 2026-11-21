# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/blessed-user/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/blessed-user/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: 226 pre-token DeFi protocols ranked by implied value, built for make.fun's "Build the best token launch radar" bounty. Each protocol gets an implied token value from a category-calibrated model over the sealed DefiLlama snapshot, plus a concrete farm plan. The dashboard ranks all 226, with a detail view per protocol.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Requires Node 22+. The snapshot is the competition kit's sealed input (`kit/input/snapshot.json`). The board lands in `out/board.json`; open `dashboard/index.html` in a browser to explore it.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
