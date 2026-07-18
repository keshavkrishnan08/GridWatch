# regions/

One folder per bootstrapped region, each self-contained.

```bash
python3 -m pipeline.bootstrap --region "Ohio, United States"
```

writes `regions/ohio-united-states/` containing the region's boundary,
subdivisions, grid layers, discovered facilities, computed `meta.json`, and the
`region.json` the app reads. Publish one with `--activate`, which copies it into
`public/data/` (backing up whatever was there into `regions/_backup/`).

The bulky generated `.geojson` layers are git-ignored — they're reproducible
from the source at any time. The small JSON files are kept as worked examples.

`ohio-united-states/` is a real run: 88 counties, 293 power plants, 11,095
transmission segments, 3,105 substations, and 43 data centers discovered and
de-duplicated automatically. Nothing about it was hand-entered.

See [`../FORKING.md`](../FORKING.md) for the full guide.
